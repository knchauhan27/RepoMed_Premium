import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOffset, resolveResultLimit } from "../_shared/question-access.mjs";

type RequestBody = {
  subject?: unknown;
  years?: unknown;
  topics?: unknown;
  subtopics?: unknown;
  exams?: unknown;
  marks?: unknown;
  types?: unknown;
  search?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
  page?: unknown;
  pageSize?: unknown;
  includeOptions?: unknown;
};

const defaultAllowedOrigins =
  "https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500";
const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? defaultAllowedOrigins)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const subjectMap: Record<string, string> = {
  Anatomy: "Anatomy",
  Physiology: "Physiology",
  Biochemistry: "Biochemistry",
  Patho: "Pathology",
  Pharmac: "Pharmacology",
  Micro: "Microbiology",
  "PSM/CM": "PSM",
  FM: "FMT",
  ENT: "ENT",
  Ophthal: "Ophthalmology",
  Pediatrics: "Pediatrics",
  Medicine: "Medicine",
  Surgery: "Surgery",
  Obstetrics: "Obstetrics",
  Gynaecology: "Gynaecology",
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-repomed-device",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  // Never reflect arbitrary origins and never use a wildcard with auth headers.
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function isAllowedOrigin(request: Request) {
  return allowedOrigins.has(request.headers.get("origin") ?? "");
}

function forbiddenPreflight(request: Request) {
  return new Response(null, {
    status: 403,
    headers: { Vary: "Origin" },
  });
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function requiredString(value: unknown, name: string, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${name} is invalid`);
  }
  return value.trim();
}

function stringArray(value: unknown, name: string, maxItems = 50) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name} is invalid`);
  return value.map((item) => requiredString(item, name));
}

function integerArray(value: unknown, name: string, maxItems = 50) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => !Number.isInteger(item))) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function normalizeRequest(body: RequestBody) {
  const sortBy = ["year", "marks", "topic", "subtopic"].includes(String(body.sortBy))
    ? String(body.sortBy)
    : "year";
  const requestedSubject = requiredString(body.subject, "subject");
  const subject = subjectMap[requestedSubject];
  if (!subject) throw new Error("subject is invalid");
  const marks = body.marks === undefined || body.marks === null || body.marks === "" ? null : Number(body.marks);
  if (marks !== null && (!Number.isFinite(marks) || marks < 0)) throw new Error("marks is invalid");
  return {
    subject,
    years: integerArray(body.years, "years"),
    topics: stringArray(body.topics, "topics"),
    subtopics: stringArray(body.subtopics, "subtopics"),
    exams: stringArray(body.exams, "exams"),
    types: stringArray(body.types, "types"),
    marks,
    search: body.search === undefined || body.search === null || body.search === "" ? "" : requiredString(body.search, "search", 200),
    sortBy,
    ascending: String(body.sortOrder) === "asc",
    page: body.page,
    pageSize: body.pageSize,
    includeOptions: body.includeOptions !== false,
  };
}

function applyFilters(query: any, filters: ReturnType<typeof normalizeRequest>) {
  query = query.eq("subject", filters.subject);
  if (filters.years.length) query = query.in("year", filters.years);
  if (filters.topics.length) query = query.in("topic", filters.topics);
  if (filters.subtopics.length) query = query.in("subtopic", filters.subtopics);
  if (filters.exams.length) query = query.in("exam", filters.exams);
  if (filters.types.length) query = query.in("type", filters.types);
  if (filters.marks !== null && Number.isFinite(filters.marks)) query = query.eq("marks", filters.marks);
  if (filters.search) query = query.ilike("question", `%${filters.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  return query;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validatePremiumDevice(admin: any, userId: string, deviceToken: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(deviceToken)) return { allowed: false, status: 403, error: "This premium account needs a registered device" };
  const tokenHash = await sha256Hex(deviceToken);
  const { data: existing, error: lookupError } = await admin.from("devices").select("id, token_hash").eq("user_id", userId).is("revoked_at", null).maybeSingle();
  if (lookupError) {
    console.error("Unable to look up premium device", { userId, message: lookupError.message });
    return { allowed: false, status: 500, error: "Unable to validate this device" };
  }
  if (existing) {
    if (existing.token_hash !== tokenHash) return { allowed: false, status: 403, error: "Premium access is limited to one registered device. Replace the existing device to continue." };
    const { error } = await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", existing.id);
    return error ? { allowed: false, status: 500, error: "Unable to validate this device" } : { allowed: true };
  }
  const { error: insertError } = await admin.from("devices").insert({ user_id: userId, token_hash: tokenHash, label: "browser" });
  if (!insertError) return { allowed: true };
  const { data: raced } = await admin.from("devices").select("token_hash").eq("user_id", userId).is("revoked_at", null).maybeSingle();
  if (raced?.token_hash === tokenHash) return { allowed: true };
  console.error("Unable to register premium device", { userId, message: insertError.message });
  return { allowed: false, status: 500, error: "Unable to validate this device" };
}

async function subjectOptions(admin: any, subject: string) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await admin
      .from("questions")
      .select("year, topic, subtopic, exam, marks, type")
      .eq("subject", subject)
      .range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  const unique = (field: string, numeric = false) =>
    [...new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== ""))].sort(
      numeric ? (a, b) => Number(a) - Number(b) : (a, b) => String(a).localeCompare(String(b)),
    );
  return {
    years: unique("year", true).reverse(),
    topics: unique("topic"),
    subtopics: unique("subtopic"),
    exams: unique("exam"),
    marks: unique("marks", true),
    types: unique("type"),
  };
}

async function handleRequest(request: Request) {
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, { error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return json(request, { error: "Server configuration error" }, 500);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const token = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(request, { error: "Invalid session" }, 401);

  let filters;
  try {
    filters = normalizeRequest(await request.json());
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Invalid request" }, 400);
  }

  // Do not put an RPC in the request hot path. The service-role Edge Function
  // can safely evaluate normalized entitlements with ordinary read queries.
  const now = new Date().toISOString();
  const { data: entitlementRows, error: entitlementError } = await admin
    .from("user_entitlements")
    .select("product_id")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("expires_at", now);
  if (entitlementError) {
    console.error("Unable to load product entitlements", { userId: userData.user.id, message: entitlementError.message });
    return json(request, { error: "Unable to check access" }, 500);
  }
  const productIds = (entitlementRows ?? []).map((row: { product_id: string }) => row.product_id);
  let isPremium = false;
  if (productIds.length) {
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, all_access")
      .in("id", productIds)
      .eq("active", true);
    if (productsError) return json(request, { error: "Unable to check access" }, 500);
    if ((products ?? []).some((product: { all_access: boolean }) => product.all_access)) {
      isPremium = true;
    } else {
      const activeProductIds = (products ?? []).map((product: { id: string }) => product.id);
      if (activeProductIds.length) {
        const { data: mappings, error: mappingError } = await admin
          .from("product_subjects")
          .select("product_id")
          .in("product_id", activeProductIds)
          .eq("subject_key", filters.subject);
        if (mappingError) return json(request, { error: "Unable to check access" }, 500);
        isPremium = (mappings ?? []).length > 0;
      }
    }
  }
  if (isPremium) {
    const device = await validatePremiumDevice(admin, userData.user.id, request.headers.get("x-repomed-device") ?? "");
    if (!device.allowed) return json(request, { error: device.error }, device.status);
  }
  const pageSize = resolveResultLimit(isPremium, filters.pageSize);
  const offset = resolveOffset(isPremium, filters.page, pageSize);
  const result = await applyFilters(
    admin.from("questions").select("id, college, subject, part, year, exam, marks, type, topic, subtopic, question", { count: "exact" }),
    filters,
  )
    .order(filters.sortBy, { ascending: filters.ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (result.error) return json(request, { error: "Unable to load questions" }, 500);

  const questions = result.data ?? [];
  const total = result.count ?? 0;
  const page = isPremium ? Math.floor(offset / pageSize) : 0;
  const hasMore = isPremium && offset + questions.length < total;
  const payload: Record<string, unknown> = {
    questions,
    total,
    limit: pageSize,
    offset,
    page,
    hasMore,
    access: {
      isPremium,
      previewLimit: isPremium ? null : pageSize,
    },
  };

  // Filter options are needed for the initial render only. Skipping the
  // auxiliary scan on subsequent pages keeps large premium subjects fast.
  if (filters.includeOptions) {
    try {
      payload.options = await subjectOptions(admin, filters.subject);
    } catch (error) {
      return json(request, { error: "Unable to load filter options" }, 500);
    }
  }
  return json(request, payload);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request)) return forbiddenPreflight(request);
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    return await handleRequest(request);
  } catch (error) {
    console.error("Unhandled get-questions error:", error);
    return json(request, { error: "Internal server error" }, 500);
  }
});
