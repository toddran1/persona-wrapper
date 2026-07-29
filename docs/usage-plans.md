# Usage plans

The application has a billing-independent entitlement and usage foundation. Payment providers are intentionally not connected yet.

## Current catalog

Plan definitions are versioned in `apps/api/src/services/planCatalog.ts`.

| Plan | Intended monthly price | Total monthly usage ceiling | Image credits / month | Medium-image equivalent | Audio / month | Internal provider-cost target / ceiling | Personas | Ads | Concurrent media jobs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| Bronze | Free | $1.00 internal cost | 12 | 6 | 5 minutes | $0.50 / $1.00 | LaRae | Planned | 1 |
| Silver | $5.99 | $3.00 internal cost | 60 | 30 | 30 minutes | $1.75 / $3.00 | Most/current configured personas | No | 2 |
| Gold | $9.99 | $5.75 internal cost | 120 | 60 | 60 minutes | $3.25 / $5.75 | All/current configured personas | No | 3 |

These are initial product assumptions, not billing promises. Change limits by introducing a new plan version rather than rewriting historical usage events.

The catalog includes intended monthly prices as metadata only; payment providers and paid entitlement assignment are not connected yet. The provider-cost ceilings remain below the planned post-store revenue so paid tiers retain room for app-store/payment fees, storage and egress, Render/AWS infrastructure, retries, support, taxes where applicable, and profit.

## Metering model

- Monthly periods use UTC calendar months.
- Total usage, image credits, and audio time are reserved atomically before provider work starts.
- Successful requests settle reservations to estimated provider cost, quality-aware image credits, and estimated generated-audio duration.
- Failed and cancelled requests release reservations.
- Background jobs retain reservations while retrying and settle or release at their terminal state.
- Every provider-backed chat request consumes the total-usage allowance. The total includes model tokens, searches, file search, Code Interpreter/chart sessions, generated images, image inputs, generated audio, and non-stub style-transfer calls when their provider pricing is configured.
- Images consume both total usage and image credits. Audio consumes both total usage and audio time. A remaining category allowance cannot bypass an exhausted total-usage allowance.
- Total usage is stored in micro-USD for atomic integer accounting, but clients expose only the percentage remaining. Provider dollars are not shown to customers.
- Image generation currently charges the image-credit meter: `low = 1`, `auto/medium = 2`, and `high = 8` credits per generated image. The same quality setting is used by both the direct Images API and the hosted Responses image tool.
- Image output counts, text tokens, searches, file analysis, provider/model, and estimated provider cost remain as detailed ledger meters for reconciliation and analytics.
- Product allowances and provider cost are intentionally separate. Customers receive stable product units even when a provider changes prices; provider-specific pricing adapters translate normalized usage into an internal USD estimate.
- The monthly provider-cost target is an operating target. The ceiling is the total-usage quota and becomes enforceable with the other product allowances when `CUSTOMER_USAGE_ENFORCEMENT_ENABLED=true`.
- TTS, image-input, and style-transfer estimates are provider-neutral environment settings. Review them whenever those providers or contracts change. Unknown provider features are reported as unpriced rather than silently assigned an invented cost.
- Using the July 2026 OpenAI reference price for a 1024×1024 `gpt-image-2` medium output ($0.053 before prompt or reference-image input), the image allowance alone is approximately $0.32 / $1.59 / $3.18 for Bronze / Silver / Gold.
- Reservations older than six hours are released by background cleanup. Settled usage events are retained for 400 days.

The durable tables are:

- `user_plan_assignments`
- `customer_usage_balances`
- `customer_usage_events`

Users without an active assignment receive Bronze. The assignment table is ready for a later App Store, Play Store, Stripe, or administrative entitlement adapter.

## Rollout

`CUSTOMER_USAGE_ENFORCEMENT_ENABLED` defaults to `false`. In this shadow mode the API records and displays usage but does not reject requests for exceeding a product allowance.

Before enabling enforcement in an environment:

1. Apply database migration `0015_customer_usage_plans.sql`.
2. Confirm image and audio usage agrees with provider and storage records for at least one full test cycle.
3. Compare total-usage estimates against provider invoices, including audio, reference images, searches, Code Interpreter, and style transfer.
4. Verify retries, cancellations, safety rejections, and background timeouts return reservations to zero.
5. Decide final allowances and reset messaging.
6. Populate paid plan assignments through the future billing entitlement adapter.
7. Enable `CUSTOMER_USAGE_ENFORCEMENT_ENABLED=true` in that environment.

The existing provider spend and request-rate controls remain separate. Product allowances protect plan entitlements; provider controls protect the application account and budget.

## Abuse protection

Plan enforcement does not rely on user ID alone:

- The monthly total-usage, image-credit, and audio allowances remain attached to the account. Sharing a paid account across devices does not multiply its allowance.
- Chat requests are independently limited by account, pseudonymous installation/device ID, and IP address. The account threshold is the strictest; device and IP thresholds are higher to accommodate legitimate multi-account devices and shared networks.
- Device and IP values used for abuse counters are protected with a deployment-keyed HMAC before they are stored in the usage-event ledger.
- Email registration attempts are limited across a rolling 30-day window to three per installation and one hundred per IP by default. This makes rotating free accounts materially harder without treating an IP address as proof that accounts belong to one person.
- The existing daily provider token/spend limits remain a final per-account safety boundary in addition to monthly plan enforcement.
- Client-supplied device IDs are only one signal and are not trusted as identity or authorization. Authentication and owner-scoped database queries remain authoritative.

Relevant environment controls are:

- `CHAT_RATE_LIMIT_REQUESTS` and `CHAT_RATE_LIMIT_WINDOW_MS`
- `CHAT_DEVICE_RATE_LIMIT_REQUESTS`
- `CHAT_IP_RATE_LIMIT_REQUESTS`
- `AUTH_SIGNUP_DEVICE_LIMIT`
- `AUTH_SIGNUP_IP_LIMIT`
- `AUTH_SIGNUP_WINDOW_MS`
- `OPENAI_DAILY_SPEND_LIMIT_USD` and `OPENAI_DAILY_TOKEN_LIMIT`

Review rejection telemetry before lowering device or IP thresholds. Carrier-grade NAT, workplaces, schools, libraries, and households can legitimately place many users behind one public IP.
