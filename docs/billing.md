# Billing and subscriptions

The first billing adapter uses RevenueCat for Apple App Store and Google Play
subscriptions. RevenueCat handles store receipts, while the API remains the
only authority that grants a Silver or Gold plan. The mobile SDK never writes
plan assignments directly.

Web subscriptions use RevenueCat Web Purchase Links. The API creates an
identified checkout URL for the signed-in application user, RevenueCat handles
payment, and the same webhook used by mobile grants the plan server-side. The
web client never grants itself paid access.

## Product catalog

Create matching products in App Store Connect, Google Play Console, and
RevenueCat:

| Plan | Apple product ID | Google product/base plan | RevenueCat entitlement | Price |
| --- | --- | --- | --- | --- |
| Silver | `com.forthebaddiez.silver.monthly` | `com.forthebaddiez.silver` / `silver-monthly` | `silver` | $7.99/month |
| Gold | `com.forthebaddiez.gold.monthly` | `com.forthebaddiez.gold` / `gold-monthly` | `gold` | $11.99/month |

Create a RevenueCat offering named `default` and add both monthly packages.
RevenueCat reports the Google products as
`com.forthebaddiez.silver:silver-monthly` and
`com.forthebaddiez.gold:gold-monthly`; the API accepts both those full IDs and
their base product IDs. The former `ftb_silver_monthly` and
`ftb_gold_monthly` IDs remain server-only aliases so existing test receipts do
not unexpectedly lose access, but clients do not advertise those products.

The identifiers live in `packages/shared/src/index.ts`. Plan allowances and
fallback display prices remain versioned in
`apps/api/src/services/planCatalog.ts`.

## RevenueCat project setup

1. Complete the paid-app agreements, tax, and banking setup in App Store
   Connect and Google Play Console.
2. Connect both store apps to one RevenueCat project.
3. Create the products, entitlements, and `default` offering above. Put both
   Apple products in the same subscription group and rank Gold above Silver.
   Configure the Google `silver-monthly` and `gold-monthly` base plans as
   active monthly offers, then verify RevenueCat imports both product/base-plan
   combinations for replacement purchases.
4. Configure this webhook URL:
   `https://<api-host>/api/billing/revenuecat/webhook`.
5. Give the webhook a long random Authorization value and set the identical
   value as `REVENUECAT_WEBHOOK_AUTHORIZATION` on the API.
6. Set `REVENUECAT_ALLOWED_APP_IDS` to the comma-separated RevenueCat app IDs.
   This prevents another project/app from granting access even if a webhook
   secret is accidentally reused.
7. Add a RevenueCat Web Billing app, create matching Silver and Gold web
   products, and attach them to the `default` offering.
8. Create custom Silver and Gold packages in that offering and create a Web
   Purchase Link. Use the generated sandbox link for development and the
   production link for production.
9. Add the RevenueCat Web Billing app ID to `REVENUECAT_ALLOWED_APP_IDS` so its
   webhook events are accepted by the API.
   During sandbox checkout testing, also include `SANDBOX` in
   `REVENUECAT_ALLOWED_ENVIRONMENTS`; switch the Purchase Link and allowed
   environment to `PRODUCTION` for live billing.

   Each web package must be attached to exactly one matching entitlement:
   Silver to `silver` and Gold to `gold`. The API resolves a webhook by its
   registered product ID first, then uses a single matching entitlement as a
   safe fallback for web/Stripe product IDs. Do not attach both paid
   entitlements to the same package.
10. Configure Silver-to-Gold and Gold-to-Silver package-change paths for the
    RevenueCat Web purchase flow. Upgrades should be immediate and downgrades
    should begin at the next renewal.
11. Enable Google Play real-time developer notifications in RevenueCat.
    Deferred Google downgrades depend on those notifications reaching
    RevenueCat and the application webhook.

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
REVENUECAT_SECRET_API_KEY=<secret-api-key-with-customer-information-read-access>
REVENUECAT_WEBHOOK_AUTHORIZATION=<long-random-shared-value>
REVENUECAT_ALLOWED_ENVIRONMENTS=SANDBOX
REVENUECAT_ALLOWED_APP_IDS=<revenuecat-ios-app-id>,<revenuecat-android-app-id>
REVENUECAT_WEB_PURCHASE_LINK_URL=https://pay.rev.cat/<sandbox-purchase-link-token>
REVENUECAT_WEB_SILVER_PACKAGE_ID=<silver-custom-package-id>
REVENUECAT_WEB_GOLD_PACKAGE_ID=<gold-custom-package-id>
```

Production should use `REVENUECAT_ALLOWED_ENVIRONMENTS=PRODUCTION`. Do not
allow SANDBOX in production; sandbox events would otherwise grant paid access.
Set the production API's `REVENUECAT_WEB_PURCHASE_LINK_URL` to RevenueCat's
production Purchase Link, not its sandbox link.

Purchase Links are used only when a Bronze member starts a paid subscription.
Existing paid members must change plans through RevenueCat Billing's Customer
Portal so the configured upgrade and downgrade paths are applied. The API uses
`REVENUECAT_SECRET_API_KEY` only server-side to fetch the authenticated portal
URL for the signed-in App User ID. Create a secret key with the minimum
customer and subscription read permissions; never expose it through the web or
mobile clients.

`render.yaml` enables billing for the hosted development and production APIs
and declares secret values without committing them. A deployment will fail
closed if the webhook authorization or allowed RevenueCat app IDs are absent.

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
- Paid users can explicitly switch between Silver and Gold in Plan & usage.
  Apple performs the change inside the shared subscription group. Android
  supplies the active product to RevenueCat and uses prorated charging for an
  upgrade or a deferred replacement for a downgrade.
- A mobile subscription purchased from another platform cannot be replaced in
  the current store. The app directs that user to Manage subscription instead
  of risking a second active subscription.
- Manage subscription remains available for cancellation, payment-method
  changes, and store-level subscription details.
- Signing out logs out of RevenueCat as well, preventing account state from
  leaking between users on a shared device.
- Web checkout opens an identified RevenueCat Purchase Link containing only
  the authenticated application user ID and selected package ID. The web app
  polls the API for a bounded period while the existing webhook records the
  subscription. A delayed webhook remains recoverable by reopening Plan &
  usage; access is never granted from the browser's success state alone.
- Web upgrades are polled until the upgraded plan is active. Web downgrades
  remain on the current plan until renewal, so the client reports the scheduled
  change without prematurely reducing access.
- RevenueCat `PRODUCT_CHANGE` webhooks are informational and do not grant or
  revoke access. Effective purchase/renewal/expiration events remain the
  authority for plan access.
- Browser pop-up blocking leaves the user on the plan page with a retryable
  message. Configure RevenueCat's Purchase Link success behavior for a useful
  confirmation page, but do not treat that redirect as proof of payment.
- If a webhook was previously recorded as ignored because its app ID,
  environment, product mapping, or entitlement mapping was corrected later,
  resend it from RevenueCat's Events view after deploying the correction. The
  API deliberately reprocesses an ignored event on a later delivery.
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
- Confirm the Apple products share one subscription group with Gold ranked
  above Silver, and that Google real-time developer notifications are active.
- Verify purchase, cancellation, expiration, refund, restore, and account
  switching with sandbox accounts on both platforms.
- Verify Silver-to-Gold upgrades and Gold-to-Silver deferred downgrades on
  Apple, Google, and RevenueCat Web.
- Verify an interrupted purchase and a delayed webhook leave the client in a
  recoverable pending state without granting access locally.
- Verify a duplicate webhook returns `duplicate` and does not create a second
  plan assignment.
- Confirm Bronze remains active after paid expiration and admin/test overrides
  continue to outrank subscription assignments.
- Change `REVENUECAT_ALLOWED_ENVIRONMENTS` from `SANDBOX` to `PRODUCTION` only
  for the production API.
