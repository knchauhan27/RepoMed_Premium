import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  hmacSha256Hex,
  signaturesMatch,
} from "../_shared/razorpay-payment.mjs";
import { sendPurchaseConfirmation } from "../_shared/purchase-email.mjs";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nonEmptyString(value: unknown, name: string, maxLength = 255) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function safeWebhookRecord(event: string, eventId: string | null, payment: Record<string, unknown>) {
  // Do not retain the full webhook: it can contain payer contact/card metadata.
  return {
    source: "razorpay_webhook",
    event,
    event_id: eventId,
    payment: {
      id: payment.id,
      order_id: payment.order_id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      created_at: payment.created_at,
    },
  };
}

async function handle(request: Request) {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
  if (!webhookSecret) {
    console.error("Razorpay webhook secret is not configured");
    return reply({ error: "Webhook configuration error" }, 500);
  }

  // Razorpay signs the exact bytes it delivers. Read text before JSON parsing.
  const rawBody = await request.text();
  const receivedSignature = request.headers.get("x-razorpay-signature") ?? "";
  const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody);
  if (!signaturesMatch(expectedSignature, receivedSignature)) {
    console.warn("Rejected Razorpay webhook with an invalid signature");
    return reply({ error: "Invalid webhook signature" }, 401);
  }

  let webhook: any;
  try {
    webhook = JSON.parse(rawBody);
  } catch {
    console.warn("Rejected signed Razorpay webhook with invalid JSON");
    return reply({ error: "Invalid webhook payload" }, 400);
  }

  const event = webhook?.event;
  const eventId = request.headers.get("x-razorpay-event-id");
  // payment.captured is the primary success signal. order.paid contains the
  // same captured payment and is supported for reconciliation if enabled.
  if (event !== "payment.captured" && event !== "order.paid") {
    console.log("Ignored signed Razorpay webhook event", { event, eventId });
    return reply({ received: true, ignored: true });
  }

  let payment: Record<string, unknown>;
  let razorpayPaymentId: string;
  let razorpayOrderId: string;
  try {
    payment = webhook?.payload?.payment?.entity;
    if (!payment || typeof payment !== "object") throw new Error("payment is invalid");
    razorpayPaymentId = nonEmptyString(payment.id, "payment.id");
    razorpayOrderId = nonEmptyString(payment.order_id, "payment.order_id");
    if (payment.status !== "captured" || payment.captured !== true) {
      throw new Error("payment is not captured");
    }
    if (!Number.isInteger(payment.amount) || payment.amount <= 0) throw new Error("payment.amount is invalid");
    if (payment.currency !== "INR") throw new Error("payment.currency is invalid");
  } catch (error) {
    console.warn("Ignored signed Razorpay success event with invalid payment data", {
      event,
      eventId,
      reason: error instanceof Error ? error.message : "invalid payload",
    });
    return reply({ received: true, ignored: true });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return reply({ error: "Server configuration error" }, 500);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .select("id, user_id, razorpay_order_id, amount_paise, currency, referral_reservation_id")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  if (orderError) {
    console.error("Unable to locate payment order for signed Razorpay webhook", { event, eventId, razorpayOrderId });
    return reply({ error: "Unable to reconcile payment" }, 500);
  }
  if (!order) {
    // A valid event for an order outside RepoMed must not be retried forever.
    console.warn("Ignored signed Razorpay webhook for an unknown order", { event, eventId, razorpayOrderId });
    return reply({ received: true, ignored: true });
  }
  if (payment.amount !== order.amount_paise || payment.currency !== order.currency) {
    console.error("Signed Razorpay webhook payment does not match local order", {
      event,
      eventId,
      razorpayOrderId,
      razorpayPaymentId,
    });
    return reply({ error: "Payment does not match local order" }, 409);
  }

  const { data: finalized, error: finalizeError } = await admin.rpc("finalize_razorpay_payment", {
    p_payment_order_id: order.id,
    p_user_id: order.user_id,
    p_razorpay_payment_id: razorpayPaymentId,
    p_razorpay_order_id: razorpayOrderId,
    p_amount_paise: payment.amount,
    p_currency: payment.currency,
    p_raw_response: { ...safeWebhookRecord(event, eventId, payment), referral_reservation_id: order.referral_reservation_id },
  });
  if (finalizeError) {
    console.error("Unable to finalize signed Razorpay webhook payment", {
      event,
      eventId,
      razorpayOrderId,
      razorpayPaymentId,
      message: finalizeError.message,
    });
    return reply({ error: "Unable to reconcile payment" }, 500);
  }

  await sendPurchaseConfirmation(admin, { razorpayPaymentId });

  // The payment ID uniqueness constraint and the finalizer's row lock make
  // duplicate delivery, browser verification, and order.paid converge safely.
  console.log("Reconciled Razorpay payment", {
    event,
    eventId,
    razorpayOrderId,
    razorpayPaymentId,
    alreadyFinalized: finalized?.already_finalized === true,
  });
  return reply({ received: true, reconciled: true, alreadyFinalized: finalized?.already_finalized === true });
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    console.error("Unhandled Razorpay webhook error", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return reply({ error: "Internal server error" }, 500);
  }
});
