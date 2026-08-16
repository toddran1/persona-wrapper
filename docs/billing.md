# Mobile billing and subscriptions

The first billing adapter uses RevenueCat for Apple App Store and Google Play
subscriptions. RevenueCat handles store receipts, while the API remains the
only authority that grants a Silver or Gold plan. The mobile SDK never writes
plan assignments directly.

## Product catalog

Create matching products in App Store Connect, Google Play Console, and
RevenueCat:

| Plan | Store product ID | RevenueCat entitlement | Price |
| --- | --- | --- | --- |
| Silver | `ftb_silver_monthly` | `silver` | $7.99/month |
| Gold | `ftb_gold_monthly` | `gold` | $11.99/month |

Create a RevenueCat offering named `default` and add both monthly packages.
Google Play base-plan suffixes are accepted by the API, so webhook product IDs
such as `ftb_silver_monthly:monthly` still map to Silver.

The identifiers live in `packages/shared/src/index.ts`. Plan allowances and
fallback display prices remain versioned in
`apps/api/src/services/planCatalog.ts`.

## RevenueCat project setup

1. Complete the paid-app agreements, tax, and banking setup in App Store
   Connect and Google Play Console.
2. Connect both store apps to one RevenueCat project.
3. Create the products, entitlements, and `default` offering above.
4. Configure this webhook URL:
   `https://<api-host>/api/billing/revenuecat/webhook`.
5. Give the webhook a long random Authorization value and set the identical
   value as `REVENUECAT_WEBHOOK_AUTHORIZATION` on the API.
6. Set `REVENUECAT_ALLOWED_APP_IDS` to the comma-separated RevenueCat app IDs.
   This prevents another project/app from granting access even if a webhook
   secret is accidentally reused.

Webhook event IDs are persisted before processing. Duplicate deliveries are
safe, in-progress duplicates return a retryable response, failed events can be
retried, abandoned in-progress events become eligible for retry after five
minutes, and older subscription events cannot overwrite newer state.
Cancellation, pause, and billing-issue events preserve access only through the
store-provided expiration date; RevenueCat `EXPIRATION` events revoke it. A
`REFUND_REVERSED` event can restore access when RevenueCat supplies a current
expiration date. Temporary entitlement grants are intentionally ignored
because those events do not identify which application tier to grant; use a
time-bound support override instead.

## API environment

Development/sandbox:

```dotenv
BILLING_ENABLED=true
BILLING_PROVIDER=revenuecat
REVENUECAT_OFFERING_ID=default
REVENUECAT_WEBHOOK_AUTHORIZATION=<long-random-shared-value>
REVENUECAT_ALLOWED_ENVIRONMENTS=SANDBOX
REVENUECAT_ALLOWED_APP_IDS=<revenuecat-ios-app-id>,<revenuecat-android-app-id>
```

Production should use `REVENUECAT_ALLOWED_ENVIRONMENTS=PRODUCTION`. Do not
allow SANDBOX in production; sandbox events would otherwise grant paid access.

`render.yaml` keeps billing disabled by default and declares the secret values
without committing them. Enable billing only after the database migration and
RevenueCat webhook are configured.

## Production Render environment

`render.yaml` defines a separate production stack alongside development:

- API: `for-the-baddiez-api` at `https://for-the-baddiez-api.onrender.com`
- Web: `for-the-baddiez-web` at `https://for-the-baddiez-web.onrender.com`
- Database: `for-the-baddiez-db`

The production API uses a separate Better Auth secret and Postgres database,
and writes R2 objects beneath the `production/` prefix. Before creating or
deploying the blueprint, enter the production values for every Render variable
marked `sync: false`, including the provider keys, Gmail app password, OAuth
credentials, R2 access-key pair, and observability credentials if used. Use a
production-specific R2 token if possible; prefixes organize objects but do not
isolate credentials within the same bucket.

After Render provisions the stack, add these callback URLs in Google and
Facebook before testing sign-in:

```text
https://for-the-baddiez-api.onrender.com/api/auth/callback/google
https://for-the-baddiez-api.onrender.com/api/auth/callback/facebook
```

For mobile production builds, create the documented EAS production environment
variables using these production API and web URLs. Do not point a store build
at the development Render services.

## EAS environment

The SDK keys are RevenueCat public app-specific keys, not RevenueCat secret API
keys. Add the following to the EAS `production` environment (the store-testing
profiles — `testflight` and `play-internal` — also use `production`), using the
appropriate API/web hosts:

```bash
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<production-api-host> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_WEB_APP_URL --value https://<production-web-host> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_ANDROID_APP_LINK_HOST --value <production-web-host> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value <revenuecat-ios-public-sdk-key> --visibility sensitive
eas env:create --environment production --name EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY --value <revenuecat-android-public-sdk-key> --visibility sensitive
```

The `preview` profile is the only one that still points at the hosted dev
environment; repeat the host variables with `--environment preview` only if you
change its hardcoded dev URLs.
Production EAS builds deliberately fail configuration if either key is absent,
if either endpoint is localhost, or if an endpoint is not HTTPS.

## Purchase behavior

- The SDK is configured with the authenticated application user ID. This lets
  webhook `app_user_id` resolve to one owner-scoped account.
- A successful store purchase is followed by bounded API polling while the
  RevenueCat webhook updates the server plan.
- Restore purchases is always available in a configured store build.
- Paid users change or cancel plans through the native store subscription
  manager. This avoids incorrect Android replacement/proration handling.
- Signing out logs out of RevenueCat as well, preventing account state from
  leaking between users on a shared device.
- Configure RevenueCat's restore/transfer behavior to keep purchases with the
  original identified App User ID. Account sharing and automatic transfers to
  a different application account are not supported; customer support should
  review those cases before granting an override.

Test purchases on real store/sandbox builds. Expo Go does not include the
RevenueCat native module, and local development without public SDK keys keeps
the subscription controls disabled.

## Release checklist

- Apply migration `0022_revenuecat_billing.sql` before enabling the webhook.
- Confirm the two store products are active and attached to `default`.
- Verify purchase, cancellation, expiration, refund, restore, and account
  switching with sandbox accounts on both platforms.
- Verify an interrupted purchase and a delayed webhook leave the client in a
  recoverable pending state without granting access locally.
- Verify a duplicate webhook returns `duplicate` and does not create a second
  plan assignment.
- Confirm Bronze remains active after paid expiration and admin/test overrides
  continue to outrank subscription assignments.
- Change `REVENUECAT_ALLOWED_ENVIRONMENTS` from `SANDBOX` to `PRODUCTION` only
  for the production API.
