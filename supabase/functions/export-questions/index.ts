import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

type RequestBody = {
  subject?: unknown; years?: unknown; topics?: unknown; subtopics?: unknown;
  exams?: unknown; marks?: unknown; types?: unknown; search?: unknown;
  sortBy?: unknown; sortOrder?: unknown;
};

type Question = {
  id: string; college: string | null; subject: string; part: number | null;
  year: number | null; exam: string | null; marks: number | null; type: string;
  topic: string; subtopic: string; question: string;
};

const MAX_EXPORT_QUESTIONS = 10_000;
const defaultAllowedOrigins = "https://repomed.in,https://www.repomed.in,http://localhost:5500,http://127.0.0.1:5500";
const allowedOrigins = new Set((Deno.env.get("ALLOWED_ORIGINS") ?? defaultAllowedOrigins).split(",").map((value) => value.trim()).filter(Boolean));
const subjectMap: Record<string, string> = {
  Anatomy: "Anatomy", Physiology: "Physiology", Biochemistry: "Biochemistry", Patho: "Pathology",
  Pharmac: "Pharmacology", Micro: "Microbiology", "PSM/CM": "PSM", FM: "FMT", ENT: "ENT",
  Ophthal: "Ophthalmology", Pediatrics: "Pediatrics", Medicine: "Medicine", Surgery: "Surgery",
  Obstetrics: "Obstetrics", Gynaecology: "Gynaecology",
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-repomed-device",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin",
  };
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
}
function requiredString(value: unknown, name: string, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new Error(`${name} is invalid`);
  return value.trim();
}
function stringArray(value: unknown, name: string, maxItems = 50) {
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name} is invalid`);
  return value.map((item) => requiredString(item, name));
}
function integerArray(value: unknown, name: string, maxItems = 50) {
  if (value === undefined) return [] as number[];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => !Number.isInteger(item))) throw new Error(`${name} is invalid`);
  return value as number[];
}
function normalizeRequest(body: RequestBody) {
  const requestedSubject = requiredString(body.subject, "subject");
  const subject = subjectMap[requestedSubject];
  if (!subject) throw new Error("subject is invalid");
  const marks = body.marks === undefined || body.marks === null || body.marks === "" ? null : Number(body.marks);
  if (marks !== null && (!Number.isFinite(marks) || marks < 0)) throw new Error("marks is invalid");
  return {
    subject, years: integerArray(body.years, "years"), topics: stringArray(body.topics, "topics"),
    subtopics: stringArray(body.subtopics, "subtopics"), exams: stringArray(body.exams, "exams"),
    types: stringArray(body.types, "types"), marks,
    search: body.search === undefined || body.search === null || body.search === "" ? "" : requiredString(body.search, "search", 200),
    sortBy: ["year", "marks", "topic", "subtopic"].includes(String(body.sortBy)) ? String(body.sortBy) : "year",
    ascending: String(body.sortOrder) === "asc",
  };
}
function applyFilters(query: any, filters: ReturnType<typeof normalizeRequest>) {
  query = query.eq("subject", filters.subject);
  if (filters.years.length) query = query.in("year", filters.years);
  if (filters.topics.length) query = query.in("topic", filters.topics);
  if (filters.subtopics.length) query = query.in("subtopic", filters.subtopics);
  if (filters.exams.length) query = query.in("exam", filters.exams);
  if (filters.types.length) query = query.in("type", filters.types);
  if (filters.marks !== null) query = query.eq("marks", filters.marks);
  if (filters.search) query = query.ilike("question", `%${filters.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  return query;
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cleanText(value: unknown) {
  // Standard PDF fonts cannot render every Unicode code point. Keep exports
  // legible without accepting HTML from the request.
  return String(value ?? "").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7E]/g, "?").trim();
}
function wrap(text: string, font: any, size: number, maxWidth: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
async function buildPdf(questions: Question[], subject: string, filters: ReturnType<typeof normalizeRequest>, email: string | undefined) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 42; const purple = rgb(0.36, 0.30, 0.96); const dark = rgb(0.12, 0.12, 0.16);
  const addPage = () => pdf.addPage(pageSize);
  const cover = addPage(); let y = 760;
  cover.drawText("RepoMed PYQ Repository", { x: 154, y, size: 25, font: bold, color: dark }); y -= 33;
  cover.drawText("Developed & Maintained by @brainspirebaroda", { x: 155, y, size: 10, font: regular, color: rgb(.38, .38, .42) }); y -= 24;
  cover.drawRectangle({ x: 190, y: y - 7, width: 215, height: 32, color: purple });
  cover.drawText(cleanText(subject), { x: 205, y: y + 4, size: 17, font: bold, color: rgb(1, 1, 1) }); y -= 45;
  cover.drawText(`Downloaded by: ${cleanText(email ?? "Premium member")}`, { x: margin, y, size: 10, font: regular, color: dark }); y -= 30;
  cover.drawText("Applied Filters", { x: margin, y, size: 14, font: bold, color: dark }); y -= 22;
  const rows = [["Years", filters.years.join(", ") || "All"], ["Topics", filters.topics.join(", ") || "All"], ["Subtopics", filters.subtopics.join(", ") || "All"], ["Exams", filters.exams.join(", ") || "All"], ["Marks", filters.marks === null ? "All" : `${filters.marks}m`], ["Types", filters.types.join(", ") || "All"], ["Search", filters.search || "All"]];
  for (const [label, value] of rows) { cover.drawText(`${label}:`, { x: margin, y, size: 10, font: bold, color: dark }); const lines = wrap(cleanText(value), regular, 10, 380); lines.forEach((line, index) => cover.drawText(line, { x: 135, y: y - index * 14, size: 10, font: regular, color: dark })); y -= Math.max(18, lines.length * 14); }
  cover.drawText("Generated for academic use only. Not for commercial redistribution.", { x: 110, y: 60, size: 9, font: regular, color: rgb(.48, .48, .52) });
  cover.drawText("brainspirebaroda@gmail.com  |  www.repomed.in", { x: 160, y: 43, size: 9, font: regular, color: rgb(.48, .48, .52) });

  let page = addPage(); y = 795; let currentTopic = ""; let questionNumber = 0;
  const nextPage = () => { page = addPage(); y = 795; };
  for (const question of questions) {
    const topic = cleanText(question.topic) || "Other";
    if (topic !== currentTopic) {
      if (y < 745) nextPage();
      page.drawRectangle({ x: margin, y: y - 7, width: 511, height: 24, color: rgb(.93, .91, 1) });
      page.drawText(topic, { x: margin + 8, y, size: 11, font: bold, color: purple }); y -= 32; currentTopic = topic;
    }
    questionNumber += 1;
    const questionLines = wrap(`${questionNumber}. ${cleanText(question.question)}`, regular, 10, 490);
    const meta = `(${cleanText(question.exam) || "-"}, ${question.year ?? "-"}, ${question.marks ?? "-"}m, P${question.part ?? "-"}, ${cleanText(question.subtopic) || "-"})`;
    const height = questionLines.length * 14 + 20;
    if (y - height < 58) nextPage();
    questionLines.forEach((line, index) => page.drawText(line, { x: margin + 4, y: y - index * 14, size: 10, font: regular, color: dark }));
    y -= questionLines.length * 14;
    page.drawText(meta, { x: margin + 8, y, size: 8, font: regular, color: rgb(.44, .44, .5) }); y -= 18;
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => { item.drawLine({ start: { x: margin, y: 34 }, end: { x: 553, y: 34 }, thickness: .5, color: rgb(.8, .8, .82) }); item.drawText("brainspirebaroda@gmail.com  |  www.repomed.in", { x: margin, y: 19, size: 8, font: regular, color: rgb(.5, .5, .54) }); item.drawText(`Page ${index + 1} of ${pages.length}`, { x: 482, y: 19, size: 8, font: regular, color: rgb(.5, .5, .54) }); });
  return await pdf.save();
}
async function fetchQuestions(admin: any, filters: ReturnType<typeof normalizeRequest>) {
  const questions: Question[] = []; const pageSize = 1000;
  for (let offset = 0; offset < MAX_EXPORT_QUESTIONS; offset += pageSize) {
    const result = await applyFilters(admin.from("questions").select("id, college, subject, part, year, exam, marks, type, topic, subtopic, question"), filters)
      .order(filters.sortBy, { ascending: filters.ascending, nullsFirst: false }).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (result.error) throw new Error("Unable to retrieve questions");
    const batch = (result.data ?? []) as Question[]; questions.push(...batch);
    if (batch.length < pageSize) return questions;
  }
  // One extra row detects a result set that cannot be safely rendered within
  // the Edge Function memory/time envelope.
  const check = await applyFilters(admin.from("questions").select("id"), filters).order(filters.sortBy, { ascending: filters.ascending, nullsFirst: false }).order("id", { ascending: true }).range(MAX_EXPORT_QUESTIONS, MAX_EXPORT_QUESTIONS);
  if (check.error) throw new Error("Unable to retrieve questions");
  if ((check.data ?? []).length) throw new Error("Too many matching questions to export at once. Narrow the filters and try again.");
  return questions;
}

async function handleRequest(request: Request) {
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  // Default-deny release switch. This remains server-side so DevTools or a
  // copied request cannot download PDFs while the UI is hidden.
  if (Deno.env.get("EXPORTS_ENABLED") !== "true") {
    return json(request, { error: "Question downloads are temporarily unavailable" }, 503);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, { error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? ""; const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return json(request, { error: "Server configuration error" }, 500);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(authorization.slice(7));
  if (userError || !userData.user) return json(request, { error: "Invalid session" }, 401);
  let filters: ReturnType<typeof normalizeRequest>;
  try { filters = normalizeRequest(await request.json()); } catch (error) { return json(request, { error: error instanceof Error ? error.message : "Invalid request" }, 400); }
  const { data: subjectAccess, error: entitlementError } = await admin.rpc("has_subject_entitlement", { p_user_id: userData.user.id, p_subject_key: filters.subject });
  if (entitlementError) return json(request, { error: "Unable to check access" }, 500);
  if (!subjectAccess) return json(request, { error: "An active plan for this subject is required to export questions" }, 403);
  const deviceToken = request.headers.get("x-repomed-device") ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(deviceToken)) return json(request, { error: "This premium account needs a registered device" }, 403);
  const { data: device, error: deviceError } = await admin.rpc("bind_premium_device", { p_user_id: userData.user.id, p_token_hash: await sha256Hex(deviceToken), p_label: "browser" });
  if (deviceError) { console.error("Unable to validate export device", { userId: userData.user.id, message: deviceError.message }); return json(request, { error: "Unable to validate this device" }, 500); }
  if (!device?.allowed) return json(request, { error: "Premium access is limited to two registered devices. Replace an existing device to continue." }, 403);
  const questions = await fetchQuestions(admin, filters);
  if (!questions.length) return json(request, { error: "No questions match the current filters" }, 400);
  const { data: reservation, error: reservationError } = await admin.rpc("reserve_export_slot", { p_user_id: userData.user.id, p_question_count: questions.length, p_filter_snapshot: filters });
  if (reservationError) { console.error("Unable to reserve export", { userId: userData.user.id, message: reservationError.message }); return json(request, { error: "Unable to reserve an export slot" }, 500); }
  if (!reservation?.allowed) return json(request, { error: "Daily export limit reached. Premium accounts can complete up to 3 exports per day (Asia/Kolkata)." }, 429);
  const jobId = reservation.job_id as string;
  try {
    const bytes = await buildPdf(questions, filters.subject, filters, userData.user.email);
    const { data: completed, error: completeError } = await admin.rpc("complete_export_job", { p_job_id: jobId, p_user_id: userData.user.id });
    if (completeError || !completed) throw new Error("Unable to complete export");
    console.info("Export completed", { jobId, userId: userData.user.id, questionCount: questions.length });
    return new Response(bytes, { status: 200, headers: { ...corsHeaders(request), "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filters.subject.replace(/[^A-Za-z0-9_-]/g, "_")}_PYQs_RepoMed.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Export failed", { jobId, userId: userData.user.id, message: error instanceof Error ? error.message : "unknown" });
    const { error: releaseError } = await admin.rpc("release_export_slot", { p_job_id: jobId, p_user_id: userData.user.id, p_failure_reason: error instanceof Error ? error.message : "Export failed" });
    if (releaseError) console.error("Unable to release export slot", { jobId, message: releaseError.message });
    return json(request, { error: "Unable to generate the PDF. Your export quota was not used." }, 500);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(request.headers.get("origin") ?? "")) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  try { return await handleRequest(request); }
  catch (error) { console.error("Unhandled export error", { message: error instanceof Error ? error.message : "unknown" }); return json(request, { error: "Unable to generate the PDF" }, 500); }
});
