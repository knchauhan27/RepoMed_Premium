# Supabase database migrations

Apply `migrations/20260901000000_premium_access.sql` through the Supabase SQL
Editor or the Supabase CLI linked to the RepoMed project.

The migration creates only the database foundation. It deliberately does not
move the existing JSON question files or change the static frontend yet.

After applying it:

1. Verify the `on_auth_user_created` trigger creates a profile for a new test
   user. Existing Auth users are backfilled by the migration.
2. Import questions using a service-role-only import script.
3. Deploy Edge Functions before exposing premium flows. The browser must never
   receive a Supabase service-role key or Razorpay secret.

## Importing the current question bank

First apply the migration so `public.questions` exists. Then validate every
JSON file without writing to Supabase:

```sh
node scripts/import-questions.mjs --dry-run
```

Import with a service-role key supplied only in your terminal environment:

```sh
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
node scripts/import-questions.mjs --apply
```

The script validates required fields, preserves nullable source values, rejects
duplicate IDs, and upserts records in batches of 500. It is safe to rerun.
Do not use the publishable/anon key from `supabase-config.js` for this command.

## Protected question preview

Deploy the `get-questions` Edge Function after the import:

```sh
supabase functions deploy get-questions
```

The function requires a signed-in user, checks `premium_entitlements`, and
returns at most ten filtered questions to users without an active entitlement.
Premium users receive internally paginated results capped at 250 per request;
the subject page continues through every page automatically. Set the
`ALLOWED_ORIGINS` function secret to a comma-separated list of allowed site
origins if you need values beyond `https://repomed.in` and
`https://www.repomed.in`.

## Razorpay Test Mode

Apply `migrations/20260901010000_razorpay_payment_finalize.sql`, then set
these Supabase Edge Function secrets from your own terminal. Do not add the
secret to source files or browser JavaScript:

```sh
supabase secrets set \
  RAZORPAY_MODE=test \
  RAZORPAY_KEY_ID="rzp_test_..." \
  RAZORPAY_KEY_SECRET="..."
```

Deploy the two payment functions only after the secrets are set:

```sh
supabase functions deploy create-razorpay-order --no-verify-jwt
supabase functions deploy verify-razorpay-payment --no-verify-jwt
```

Both functions still require a valid Supabase Bearer token and validate it
server-side with `auth.getUser`. The gateway JWT check is disabled only so
allowed-origin browser clients receive explicit CORS headers for every error
response. Test Mode is enforced: a non-test Razorpay key or mode is rejected.

## Razorpay Test Mode webhook reconciliation

Set a separate, randomly generated webhook secret. It is not the Razorpay API
key secret and must never be placed in browser code:

```sh
supabase secrets set RAZORPAY_WEBHOOK_SECRET="your-long-random-webhook-secret"
supabase functions deploy razorpay-webhook --no-verify-jwt
```

In Razorpay Dashboard **Test Mode**, add this webhook URL:

```text
https://hkludzlqmousehefgnrt.supabase.co/functions/v1/razorpay-webhook
```

Set the same webhook secret in Razorpay and subscribe to `payment.captured`.
`order.paid` is also supported by the function, but subscribing to only
`payment.captured` avoids duplicate deliveries for the same successful payment.
The handler verifies `X-Razorpay-Signature` against the raw request body before
parsing JSON, matches the signed captured payment to a local order, and calls
the same idempotent `finalize_razorpay_payment` RPC used by browser verification.

## Referral-code examples

Run these in the Supabase SQL Editor. Codes are stored uppercase; API input is
trimmed and case-normalised on the server.

```sql
-- 10% unlimited
insert into public.referral_codes (code, discount_percent, max_uses, max_uses_per_user)
values ('KUNJ10', 10, null, null);

-- 50% discount, at most 20 successful redemptions
insert into public.referral_codes (code, discount_percent, max_uses)
values ('EARLY50', 50, 20);

-- 100% discount, exactly one successful redemption
insert into public.referral_codes (code, discount_percent, max_uses, max_uses_per_user)
values ('FRIEND100', 100, 1, 1);

-- 100% discount, unlimited accounts, once per account
insert into public.referral_codes (code, discount_percent, max_uses, max_uses_per_user)
values ('CAMPUS100', 100, null, 1);

update public.referral_codes set active = false where code = 'KUNJ10';
update public.referral_codes set expires_at = now() + interval '30 days' where code = 'EARLY50';

select c.code, c.redemption_count, count(r.id) as successful_redemptions,
       coalesce(sum(r.final_amount_paise), 0) as revenue_paise,
       coalesce(sum(r.discount_amount_paise), 0) as discount_paise
from public.referral_codes c
left join public.referral_redemptions r on r.referral_code_id = c.id
where c.code = 'EARLY50'
group by c.id;
```

## Premium device binding

Premium question requests carry a randomly generated browser token. The Edge
Function hashes it, then atomically binds it to the user on first premium use.
The existing schema's partial unique index permits one active device only.
Clearing browser storage or signing in from another device is rejected until an
administrator revokes the old `public.devices` row; no hardware fingerprint,
IP address, or browser telemetry is collected.
