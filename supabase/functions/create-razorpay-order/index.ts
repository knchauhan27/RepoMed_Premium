import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertTestMode,
  PREMIUM_CURRENCY,
} from "../_shared/razorpay-payment.mjs";

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

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return reply(request, { error: "Invalid session" }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { return reply(request, { error: "Invalid JSON" }, 400); }
  const productCode = typeof body?.productCode === "string" ? body.productCode.trim().toUpperCase() : "";
  if (!/^[A-Z_]{3,32}$/.test(productCode)) return reply(request, { error: "A valid product is required" }, 400);
  const { data: product, error: productError } = await admin
    .from("products").select("id, code, name, price_paise, active").eq("code", productCode).eq("active", true).maybeSingle();
  if (productError || !product) return reply(request, { error: "This product is unavailable" }, 404);
  const referralCode = typeof body?.referralCode === "string" && body.referralCode.trim()
    ? body.referralCode.trim() : null;
  let amount = product.price_paise;
  let reservation: any = null;
  if (referralCode) {
    const { data, error } = await admin.rpc("reserve_referral_code", {
      p_user_id: userData.user.id,
      p_code: referralCode,
      p_product_code: product.code,
    });
    if (error || !data) return reply(request, { error: error?.message || "Referral code is not valid" }, 400);
    reservation = data;
    amount = Number(reservation.final_amount_paise);
    if (!Number.isInteger(amount) || amount <= 0) {
      return reply(request, { error: "This code must be redeemed without Razorpay" }, 400);
    }
  }

  const receipt = `repomed_${crypto.randomUUID().replaceAll("-", "").slice(0, 28)}`;
  const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: basicAuth(razorpayKeyId, razorpayKeySecret), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency: PREMIUM_CURRENCY,
      receipt,
      notes: { repo_med_user_id: userData.user.id, product: product.code, referral_code: reservation?.code || "" },
    }),
  });
  const razorpayOrder = await razorpayResponse.json();
  if (!razorpayResponse.ok || !razorpayOrder?.id) {
    console.error("Razorpay order error:", razorpayOrder);
    // Razorpay's API error code/description are safe operational diagnostics;
    // never return credentials, request headers, or provider payloads wholesale.
    const providerError = razorpayOrder?.error;
    const code = typeof providerError?.code === "string" ? providerError.code : null;
    const description = typeof providerError?.description === "string"
      ? providerError.description
      : "Razorpay rejected the order request";
    const diagnostic = code ? `${description} (${code})` : description;
    return reply(request, { error: `Unable to create payment order: ${diagnostic}` }, 502);
  }

  const { data: localOrder, error: insertError } = await admin
    .from("payment_orders")
    .insert({
      user_id: userData.user.id,
      product_id: product.id,
      razorpay_order_id: razorpayOrder.id,
      receipt,
      amount_paise: amount,
      currency: PREMIUM_CURRENCY,
      status: "created",
      original_amount_paise: product.price_paise,
      discount_amount_paise: product.price_paise - amount,
      referral_reservation_id: reservation?.reservation_id || null,
      referral_code: reservation?.code || null,
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("Unable to persist payment order:", insertError);
    return reply(request, { error: "Unable to save payment order" }, 500);
  }
  if (reservation?.reservation_id) {
    const { error: reservationError } = await admin
      .from("referral_reservations")
      .update({ payment_order_id: localOrder.id })
      .eq("id", reservation.reservation_id)
      .eq("user_id", userData.user.id)
      .eq("status", "reserved");
    if (reservationError) {
      console.error("Unable to attach referral reservation to payment order", reservationError);
      return reply(request, { error: "Unable to save referral reservation" }, 500);
    }
  }

  return reply(request, {
    paymentOrderId: localOrder.id,
    productCode: product.code,
    productName: product.name,
    razorpayOrderId: razorpayOrder.id,
    keyId: razorpayKeyId,
    amount,
    currency: PREMIUM_CURRENCY,
    referral: reservation ? {
      code: reservation.code,
      discountPercent: reservation.discount_percent,
      originalAmount: reservation.original_amount_paise,
      discountAmount: reservation.discount_amount_paise,
      finalAmount: reservation.final_amount_paise,
    } : null,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(request.headers.get("origin") ?? "")) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  try { return await handle(request); }
  catch (error) { console.error("Unhandled create-order error:", error); return reply(request, { error: "Internal server error" }, 500); }
});
