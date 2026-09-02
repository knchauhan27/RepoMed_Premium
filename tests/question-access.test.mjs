import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_LIMIT,
  PREMIUM_PAGE_LIMIT,
  hasActiveEntitlement,
  resolveOffset,
  resolveResultLimit,
} from "../supabase/functions/_shared/question-access.mjs";

test("a missing or expired entitlement remains on the 10-question preview", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(hasActiveEntitlement(null, now), false);
  assert.equal(hasActiveEntitlement({ status: "active", expires_at: "2026-08-31T23:59:59Z", revoked_at: null }, now), false);
  assert.equal(resolveResultLimit(false, 100), PREVIEW_LIMIT);
  assert.equal(resolveOffset(false, 9, PREVIEW_LIMIT), 0);
});

test("an active unexpired entitlement receives paginated premium access", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(hasActiveEntitlement({ status: "active", expires_at: "2026-10-01T00:00:00Z", revoked_at: null }, now), true);
  assert.equal(hasActiveEntitlement({ status: "active", expires_at: null, revoked_at: null }, now), true);
  assert.equal(resolveResultLimit(true, 500), PREMIUM_PAGE_LIMIT);
  assert.equal(PREMIUM_PAGE_LIMIT, 250);
  assert.equal(resolveResultLimit(true, 25), 25);
  assert.equal(resolveOffset(true, 2, 25), 50);
});

test("revoked entitlements never grant premium access", () => {
  assert.equal(
    hasActiveEntitlement({ status: "revoked", expires_at: null, revoked_at: "2026-09-01T00:00:00Z" }),
    false,
  );
});
