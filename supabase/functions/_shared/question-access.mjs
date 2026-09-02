export const PREVIEW_LIMIT = 10;
// This is a per-request upper bound, never an entitlement cap. Premium users
// receive additional pages only after the same authenticated server check.
export const PREMIUM_PAGE_LIMIT = 250;

export function hasActiveEntitlement(entitlement, now = new Date()) {
  if (!entitlement || entitlement.status !== "active" || entitlement.revoked_at) {
    return false;
  }
  return !entitlement.expires_at || new Date(entitlement.expires_at) > now;
}

export function resolveResultLimit(isPremium, requestedPageSize) {
  if (!isPremium) return PREVIEW_LIMIT;
  const parsed = Number(requestedPageSize);
  if (!Number.isInteger(parsed) || parsed < 1) return PREMIUM_PAGE_LIMIT;
  return Math.min(parsed, PREMIUM_PAGE_LIMIT);
}

export function resolveOffset(isPremium, page, pageSize) {
  if (!isPremium) return 0;
  const parsed = Number(page);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed * pageSize;
}
