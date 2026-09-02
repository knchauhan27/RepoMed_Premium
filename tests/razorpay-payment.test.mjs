import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  assertTestMode,
  hmacSha256Hex,
  isCapturedPremiumPayment,
  PREMIUM_AMOUNT_PAISE,
  PREMIUM_CURRENCY,
  signaturesMatch,
} from "../supabase/functions/_shared/razorpay-payment.mjs";

test("only an explicit Razorpay Test Mode key configuration is accepted", () => {
  assert.doesNotThrow(() => assertTestMode("rzp_test_example", "test_secret", "test"));
  assert.throws(() => assertTestMode("rzp_live_example", "secret", "test"));
  assert.throws(() => assertTestMode("rzp_test_example", "secret", "live"));
});

test("payment validation requires a captured matching ₹50 payment", () => {
  const payment = {
    status: "captured",
    order_id: "order_test",
    amount: PREMIUM_AMOUNT_PAISE,
    currency: PREMIUM_CURRENCY,
  };
  assert.equal(isCapturedPremiumPayment(payment, "order_test", 5000, "INR"), true);
  assert.equal(isCapturedPremiumPayment({ ...payment, amount: 1 }, "order_test", 5000, "INR"), false);
  assert.equal(isCapturedPremiumPayment({ ...payment, status: "authorized" }, "order_test", 5000, "INR"), false);
  assert.equal(isCapturedPremiumPayment(payment, "order_other", 5000, "INR"), false);
  assert.equal(isCapturedPremiumPayment({ ...payment, amount: 4500 }, "order_test", 4500, "INR"), true);
  assert.equal(isCapturedPremiumPayment({ ...payment, amount: 2500 }, "order_test", 2500, "INR"), true);
});

test("Razorpay signatures are verified exactly", async () => {
  const signature = await hmacSha256Hex("test_secret", "order_test|pay_test");
  assert.equal(signaturesMatch(signature, signature), true);
  const altered = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.equal(signaturesMatch(signature, altered), false);
  assert.equal(signaturesMatch(signature, "invalid"), false);
});

test("webhook signatures bind the original raw JSON bytes", async () => {
  const rawBody = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test"}}}}';
  const signature = await hmacSha256Hex("webhook_secret", rawBody);
  assert.equal(signaturesMatch(await hmacSha256Hex("webhook_secret", rawBody), signature), true);
  assert.equal(signaturesMatch(await hmacSha256Hex("webhook_secret", `${rawBody}\n`), signature), false);
});
