# Usage plans

The application has a billing-independent entitlement and usage foundation. Payment providers are intentionally not connected yet.

## Current catalog

Plan definitions are versioned in `apps/api/src/services/planCatalog.ts`.

| Plan | Images / month | Audio / month | Personas | Ads | Concurrent media jobs |
| --- | ---: | ---: | --- | --- | ---: |
| Bronze | 3 | 5 minutes | LaRae | Planned | 1 |
| Silver | 15 | 30 minutes | Most/current configured personas | No | 2 |
| Gold | 40 | 90 minutes | All/current configured personas | No | 3 |

These are initial product assumptions, not billing promises. Change limits by introducing a new plan version rather than rewriting historical usage events.

## Metering model

- Monthly periods use UTC calendar months.
- Media is reserved atomically before provider work starts.
- Successful requests settle reservations to actual image counts and estimated generated-audio duration.
- Failed and cancelled requests release reservations.
- Background jobs retain reservations while retrying and settle or release at their terminal state.
- Text tokens, searches, file analysis, provider/model, and estimated provider cost are recorded for internal cost analysis even though only image and audio meters are currently shown to users.
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
3. Verify retries, cancellations, safety rejections, and background timeouts return reservations to zero.
4. Decide final allowances and reset messaging.
5. Populate paid plan assignments through the future billing entitlement adapter.
6. Enable `CUSTOMER_USAGE_ENFORCEMENT_ENABLED=true` in that environment.

The existing provider spend and request-rate controls remain separate. Product allowances protect plan entitlements; provider controls protect the application account and budget.
