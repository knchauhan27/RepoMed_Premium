import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPurchaseConfirmation } from "../_shared/purchase-email.mjs";

const origins = new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500").split(",").map((v) => v.trim()));
function response(request: Request, body: unknown, status = 200) { const origin = request.headers.get("origin") ?? ""; const headers: Record<string,string> = { "Content-Type": "application/json", Vary: "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }; if (origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin; return new Response(JSON.stringify(body), { status, headers }); }
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return origins.has(request.headers.get("origin") ?? "") ? new Response(null, { status: 204, headers: response(request, {}).headers }) : new Response(null, { status: 403 });
  if (request.method !== "POST") return response(request, { error: "Method not allowed" }, 405);
  const authorization = request.headers.get("authorization"); if (!authorization?.startsWith("Bearer ")) return response(request, { error: "Authentication required" }, 401);
  let body: any; try { body = await request.json(); } catch { return response(request, { error: "Invalid JSON" }, 400); }
  if (typeof body?.referralCode !== "string" || !body.referralCode.trim() || body.referralCode.length > 64 || typeof body?.productCode !== "string") return response(request, { error: "Referral code or product is invalid" }, 400);
  const url = Deno.env.get("SUPABASE_URL") ?? ""; const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; if (!url || !key) return response(request, { error: "Server configuration error" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } }); const { data: auth, error: authError } = await admin.auth.getUser(authorization.slice(7)); if (authError || !auth?.user) return response(request, { error: "Invalid session" }, 401);
  const productCode = body.productCode.trim().toUpperCase();
  const { data: product, error: productError } = await admin.from("products").select("id,all_access").eq("code", productCode).eq("active", true).maybeSingle();
  if (productError || !product) return response(request, { error: "Product is unavailable" }, 404);
  const now = new Date().toISOString();
  const { data: activeEntitlements, error: entitlementError } = await admin.from("user_entitlements").select("product_id,products!inner(all_access)").eq("user_id", auth.user.id).eq("status", "active").is("revoked_at", null).lte("starts_at", now).gt("expires_at", now);
  if (entitlementError) return response(request, { error: "Unable to check current access" }, 500);
  if ((activeEntitlements ?? []).some((entry: any) => entry.product_id === product.id || (!product.all_access && entry.products?.all_access === true))) return response(request, { error: "You already have active access to this plan" }, 409);
  const { data, error } = await admin.rpc("redeem_free_referral_code", { p_user_id: auth.user.id, p_code: body.referralCode, p_product_code: body.productCode });
  if (error || !data?.premium) return response(request, { error: error?.message || "Referral code is not valid" }, 400);
  if (data.referral_redemption_id) {
    await sendPurchaseConfirmation(admin, { referralRedemptionId: data.referral_redemption_id });
  }
  return response(request, { premium: true, code: data.code, productCode: data.product_code, alreadyRedeemed: data.already_redeemed === true });
});
