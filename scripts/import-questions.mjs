#!/usr/bin/env node

/**
 * Imports RepoMed's JSON question bank into public.questions through the
 * Supabase REST API. It intentionally requires a service-role key at runtime;
 * never add that key to this repository or browser code.
 *
 * Usage:
 *   node scripts/import-questions.mjs --dry-run
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-questions.mjs --apply
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const BATCH_SIZE = 500;
const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIRECTORY = resolve(ROOT, "data");

if (process.argv.slice(2).some((argument) => !["--apply", "--dry-run"].includes(argument))) {
  throw new Error("Usage: node scripts/import-questions.mjs [--dry-run | --apply]");
}

function requiredString(value, field, source) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${source}: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, field, source) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${source}: ${field} must be a string or null`);
  return value.trim() || null;
}

function optionalInteger(value, field, source) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value)) throw new Error(`${source}: ${field} must be an integer or null`);
  return value;
}

function requiredNumber(value, field, source) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${source}: ${field} must be a non-negative number`);
  }
  if (Math.round(value * 100) !== value * 100) {
    throw new Error(`${source}: ${field} can have at most two decimal places`);
  }
  return value;
}

function normalizeQuestion(record, source) {
  const marks = requiredNumber(record.marks, "marks", source);

  const part = optionalInteger(record.part, "part", source);
  if (part !== null && part < 1) throw new Error(`${source}: part must be positive`);

  const year = optionalInteger(record.year, "year", source);
  if (year !== null && (year < 1900 || year > 2100)) {
    throw new Error(`${source}: year must be between 1900 and 2100`);
  }

  return {
    id: requiredString(record.id, "id", source),
    college: optionalString(record.college, "college", source),
    subject: requiredString(record.subject, "subject", source),
    part,
    year,
    exam: optionalString(record.exam, "exam", source),
    marks,
    type: requiredString(record.type, "type", source),
    topic: requiredString(record.topic, "topic", source),
    subtopic: requiredString(record.subtopic, "subtopic", source),
    question: requiredString(record.question, "question", source),
  };
}

async function loadQuestions() {
  const filenames = (await readdir(DATA_DIRECTORY))
    .filter((filename) => filename.endsWith(".json"))
    .sort();

  const ids = new Set();
  const questions = [];
  const fileCounts = [];

  for (const filename of filenames) {
    const source = `data/${filename}`;
    const parsed = JSON.parse(await readFile(resolve(DATA_DIRECTORY, filename), "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${source}: expected a JSON array`);

    for (const [index, record] of parsed.entries()) {
      if (record === null || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`${source}[${index}]: expected an object`);
      }
      const question = normalizeQuestion(record, `${source}[${index}]`);
      if (ids.has(question.id)) throw new Error(`${source}[${index}]: duplicate id ${question.id}`);
      ids.add(question.id);
      questions.push(question);
    }
    fileCounts.push([filename, parsed.length]);
  }

  return { questions, fileCounts };
}

function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function upsertBatch(url, key, batch, attempt = 1) {
  const response = await fetch(`${url}/rest/v1/questions?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });

  if (response.ok) return;

  const detail = await response.text();
  if (attempt < 3 && response.status >= 500) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 750));
    return upsertBatch(url, key, batch, attempt + 1);
  }
  throw new Error(`Supabase returned HTTP ${response.status}: ${detail}`);
}

const { questions, fileCounts } = await loadQuestions();
console.log(`Validated ${questions.length} unique questions from ${fileCounts.length} JSON files.`);
console.table(fileCounts.map(([file, count]) => ({ file, count })));

if (DRY_RUN) {
  console.log("Dry run complete. No records were sent to Supabase.");
  if (!APPLY) console.log("Re-run with --apply and runtime credentials to import.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required with --apply");
}

const batches = chunks(questions, BATCH_SIZE);
for (const [index, batch] of batches.entries()) {
  await upsertBatch(url, key, batch);
  console.log(`Imported batch ${index + 1}/${batches.length} (${batch.length} records).`);
}

console.log(`Import complete: ${questions.length} records upserted into public.questions.`);
