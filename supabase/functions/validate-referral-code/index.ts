import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500").split(",").map((v) => v.trim()));
function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return origins.has(request.headers.get("origin") ?? "") ? new Response(null, { status: 204, headers: { ...Object.fromEntries(response(request, {}).headers), "Access-Control-Max-Age": "86400" } }) : new Response(null, { status: 403 });
  if (request.method !== "POST") return response(request, { error: "Method not allowed" }, 405);
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) return response(request, { error: "Authentication required" }, 401);
  let body: any; try { body = await request.json(); } catch { return response(request, { error: "Invalid JSON" }, 400); }
  if (typeof body?.referralCode !== "string" || !body.referralCode.trim() || body.referralCode.length > 64 || typeof body?.productCode !== "string") return response(request, { valid: false });
  const url = Deno.env.get("SUPABASE_URL") ?? ""; const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return response(request, { error: "Server configuration error" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth } = await admin.auth.getUser(token.slice(7));
  if (!auth?.user) return response(request, { error: "Invalid session" }, 401);
  const { data, error } = await admin.rpc("quote_referral_code", { p_user_id: auth.user.id, p_code: body.referralCode, p_product_code: body.productCode });
  if (error || !data) return response(request, { valid: false, error: error?.message || "Referral code is not valid" });
  return response(request, { valid: true, code: data.code, productCode: data.product_code, discountPercent: data.discount_percent, originalAmount: data.original_amount_paise, discountAmount: data.discount_amount_paise, finalAmount: data.final_amount_paise });
});
