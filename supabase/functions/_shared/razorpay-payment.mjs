export const PREMIUM_AMOUNT_PAISE = 5000;
export const PREMIUM_CURRENCY = "INR";

export function assertTestMode(keyId, keySecret, mode) {
  if (mode !== "test" || !keyId?.startsWith("rzp_test_") || !keySecret) {
    throw new Error("Razorpay Test Mode is not configured");
  }
}

export function isCapturedPremiumPayment(payment, expectedOrderId, expectedAmount, expectedCurrency) {
  return payment?.status === "captured" &&
    payment.order_id === expectedOrderId &&
    payment.amount === expectedAmount &&
    payment.currency === expectedCurrency;
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function signaturesMatch(expected, received) {
  if (typeof received !== "string" || !/^[a-f0-9]{64}$/i.test(received) || expected.length !== received.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}
