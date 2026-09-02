import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "https://knchauhan27.github.io,https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500")
    .split(",").map((value) => value.trim()),
);

function headers(request: Request) {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
  const origin = request.headers.get("origin") ?? "";
  if (origins.has(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return origins.has(request.headers.get("origin") ?? "")
      ? new Response(null, { status: 204, headers: headers(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "GET") return reply(request, { error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(request, { error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return reply(request, { error: "Server configuration error" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: user } = await admin.auth.getUser(authorization.slice(7));
  if (!user.user) return reply(request, { error: "Invalid session" }, 401);

  const { data, error } = await admin
    .from("user_entitlements")
    .select("status,starts_at,expires_at,products(code,name,academic_year,all_access,product_subjects(subject_key))")
    .eq("user_id", user.user.id)
    .eq("status", "active")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at");
  if (error) return reply(request, { error: "Unable to load access" }, 500);
  return reply(request, { entitlements: data });
});
