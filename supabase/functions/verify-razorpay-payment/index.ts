import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertTestMode,
  hmacSha256Hex,
  isCapturedPremiumPayment,
  signaturesMatch,
} from "../_shared/razorpay-payment.mjs";
import { sendPurchaseConfirmation } from "../_shared/purchase-email.mjs";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500")
    .split(",").map((origin) => origin.trim()).filter(Boolean),
);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
}

function basicAuth(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error(`${name} is invalid`);
  return value;
}

async function handle(request: Request) {
  if (request.method !== "POST") return reply(request, { error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(request, { error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
  try { assertTestMode(razorpayKeyId, razorpayKeySecret, Deno.env.get("RAZORPAY_MODE")); }
  catch (error) { return reply(request, { error: error.message }, 500); }
  if (!supabaseUrl || !serviceRoleKey) return reply(request, { error: "Server configuration error" }, 500);

  let payload;
  try { payload = await request.json(); }
  catch { return reply(request, { error: "Invalid JSON" }, 400); }

  let paymentOrderId: string, razorpayPaymentId: string, razorpayOrderId: string, razorpaySignature: string;
  try {
    paymentOrderId = requiredString(payload.paymentOrderId, "paymentOrderId");
    razorpayPaymentId = requiredString(payload.razorpayPaymentId, "razorpayPaymentId");
    razorpayOrderId = requiredString(payload.razorpayOrderId, "razorpayOrderId");
    razorpaySignature = requiredString(payload.razorpaySignature, "razorpaySignature");
  } catch (error) { return reply(request, { error: error.message }, 400); }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return reply(request, { error: "Invalid session" }, 401);

  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .select("id, user_id, razorpay_order_id, amount_paise, currency, status, referral_reservation_id")
    .eq("id", paymentOrderId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (orderError || !order) return reply(request, { error: "Payment order not found" }, 404);
  if (order.razorpay_order_id !== razorpayOrderId) return reply(request, { error: "Payment order mismatch" }, 400);

  const expectedSignature = await hmacSha256Hex(razorpayKeySecret, `${order.razorpay_order_id}|${razorpayPaymentId}`);
  if (!signaturesMatch(expectedSignature, razorpaySignature)) return reply(request, { error: "Payment signature verification failed" }, 400);

  const paymentUrl = `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`;
  const paymentResponse = await fetch(paymentUrl, {
    headers: { Authorization: basicAuth(razorpayKeyId, razorpayKeySecret) },
  });
  let payment = await paymentResponse.json();
  if (!paymentResponse.ok || payment?.order_id !== order.razorpay_order_id ||
    payment?.amount !== order.amount_paise || payment?.currency !== order.currency) {
    console.warn("Razorpay payment does not match local order", {
      paymentId: payment?.id,
      paymentStatus: payment?.status,
      paymentOrderId: payment?.order_id,
      expectedOrderId: order.razorpay_order_id,
      paymentAmount: payment?.amount,
      expectedStoredAmount: order.amount_paise,
      paymentCurrency: payment?.currency,
      expectedCurrency: order.currency,
    });
    return reply(request, { error: "Payment does not match this order" }, 409);
  }

  // The Dashboard can be configured for manual/standard capture. A payment is
  // only entitled after capture, so capture the already signature-verified,
  // exact order payment here and then fetch its final state again.
  if (payment.status === "authorized") {
    const captureResponse = await fetch(`${paymentUrl}/capture`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(razorpayKeyId, razorpayKeySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: order.amount_paise, currency: order.currency }),
    });
    if (!captureResponse.ok) {
      console.error("Unable to capture authorized Razorpay payment", {
        paymentId: payment?.id,
        paymentStatus: payment?.status,
        paymentOrderId: payment?.order_id,
        expectedOrderId: order.razorpay_order_id,
        paymentAmount: payment?.amount,
        expectedStoredAmount: order.amount_paise,
        paymentCurrency: payment?.currency,
        expectedCurrency: order.currency,
      });
      return reply(request, { error: "Payment was authorised but could not be captured" }, 409);
    }
    const refreshedPaymentResponse = await fetch(paymentUrl, {
      headers: { Authorization: basicAuth(razorpayKeyId, razorpayKeySecret) },
    });
    payment = await refreshedPaymentResponse.json();
    if (!refreshedPaymentResponse.ok) return reply(request, { error: "Unable to confirm captured payment" }, 502);
  }
  if (!isCapturedPremiumPayment(payment, order.razorpay_order_id, order.amount_paise, order.currency)) {
    console.warn("Razorpay payment did not reach the required captured state", {
      paymentId: payment?.id,
      paymentStatus: payment?.status,
      paymentOrderId: payment?.order_id,
      expectedOrderId: order.razorpay_order_id,
      paymentAmount: payment?.amount,
      expectedStoredAmount: order.amount_paise,
      paymentCurrency: payment?.currency,
      expectedCurrency: order.currency,
    });
    return reply(request, { error: "Payment could not be confirmed as captured" }, 409);
  }

  const { data: finalized, error: finalizeError } = await admin.rpc("finalize_razorpay_payment", {
    p_payment_order_id: order.id,
    p_user_id: userData.user.id,
    p_razorpay_payment_id: payment.id,
    p_razorpay_order_id: payment.order_id,
    p_amount_paise: payment.amount,
    p_currency: payment.currency,
    p_raw_response: {
      payment: { id: payment.id, order_id: payment.order_id, status: payment.status, amount: payment.amount, currency: payment.currency, method: payment.method, created_at: payment.created_at },
      verification: "signature_and_api_verified",
      referral_reservation_id: order.referral_reservation_id,
    },
  });
  if (finalizeError) {
    console.error("Unable to finalize payment:", finalizeError);
    return reply(request, { error: "Unable to activate premium access" }, 500);
  }
  await sendPurchaseConfirmation(admin, { razorpayPaymentId: payment.id });
  return reply(request, { premium: true, alreadyFinalized: finalized?.already_finalized === true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(request.headers.get("origin") ?? "")) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  try { return await handle(request); }
  catch (error) { console.error("Unhandled verify-payment error:", error); return reply(request, { error: "Internal server error" }, 500); }
});
