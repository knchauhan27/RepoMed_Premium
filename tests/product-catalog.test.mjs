import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260902000000_product_subscriptions.sql", import.meta.url), "utf8");
const apexFix = readFileSync(new URL("../supabase/migrations/20260902002000_apex_pediatrics.sql", import.meta.url), "utf8");

test("the five product codes and their canonical subject mappings are seeded", () => {
  for (const code of ["EMBRYO", "SYNAPSE", "NEXUS", "APEX", "GOLD"]) assert.match(migration, new RegExp(`'${code}'`));
  for (const subject of ["Anatomy", "Physiology", "Biochemistry", "Pathology", "Pharmacology", "Microbiology", "PSM", "FMT", "ENT", "Ophthalmology", "Medicine", "Surgery", "Obstetrics", "Gynaecology"]) assert.match(migration, new RegExp(`'${subject}'`));
  assert.match(apexFix, /'Pediatrics'/);
});

test("question access is evaluated from normalized product entitlements", () => {
  assert.match(migration, /has_subject_entitlement/);
  assert.match(migration, /p\.all_access or ps\.subject_key=p_subject_key/);
});
