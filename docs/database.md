# Database Setup

The app uses PostgreSQL for durable application state. Local development uses Docker Compose and stores the Postgres data directory on the external SSD path:

```text
/Volumes/ReggieSSD/mac/coding-projects/postgres/persona_wrapper_db
```

## Local

1. Start Docker Desktop.
2. Start Postgres:

```sh
npm run db:up
```

3. Add this to `apps/api/.env`:

```env
DATABASE_URL=postgres://persona:persona_dev_password@localhost:5434/persona_wrapper_db
```

4. Run migrations:

```sh
npm run db:migrate
```

Migration `0013_user_memory_controls.sql` adds the account-level switch used to
disable future conversation-memory generation and prompt injection. Memory
content itself remains scoped to each conversation's metadata and can be
deleted per conversation or for all conversations owned by the signed-in user.

With `DATABASE_URL` unset, the API falls back to in-memory/local-only storage so existing tests and quick local runs do not require Postgres.

With `DATABASE_URL` set, the API currently persists:

- users, password credentials, OAuth account links, and auth sessions
- conversations and messages
- upload metadata and reusable vector-store metadata
- generated-media metadata
- generated-audio metadata
- background job status, provider response IDs, and completed/failed job payloads

Uploaded file bytes, generated image/file bytes, and generated audio bytes are stored through the storage adapter. Local development uses the `local` storage driver and stores bytes on disk. Hosted environments use the `s3` protocol driver against Cloudflare R2. The database stores ownership, MIME type, filenames, size, expiration, public URLs, storage keys, and provider IDs needed to manage those objects.

Recommended local media root:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/Volumes/ReggieSSD/mac/coding-projects/python/persona_wrapper/media
UPLOAD_TTL_HOURS=24
GENERATED_MEDIA_TTL_HOURS=0
GENERATED_AUDIO_TTL_HOURS=236
STORAGE_CLEANUP_INTERVAL_MS=900000
```

When `STORAGE_LOCAL_ROOT` is set, the API stores objects under:

- `uploads/`
- `generated-media/`
- `generated-audio/`

When `STORAGE_LOCAL_ROOT` is blank, the API falls back to the legacy paths:

- `UPLOAD_DIR`
- `GENERATED_MEDIA_DIR`, or `UPLOAD_DIR/generated-media`
- `GENERATED_AUDIO_DIR`, or `UPLOAD_DIR/generated-audio`

The storage health endpoint validates the active storage adapter:

```sh
curl http://localhost:4000/health/storage
```

Active OpenAI background polling and cancel controllers are still runtime process state for now. The database-backed job record is there so polling, status checks, and completed results are still available even when the original in-memory job map is gone.

## Auth

The local app can still use the `x-owner-id` header for quick persistence when auth is not required. Once users log in, request identity comes from the Better Auth session cookie. Authenticated requests set `request.auth.userId`, and persistence helpers prefer that authenticated user ID over `x-owner-id`. Media, audio, artifact, and upload download routes require an authenticated session in production; `x-owner-id` remains a dev/test fallback only.

Recommended local auth defaults:

```env
AUTH_REQUIRED=false
AUTH_REFRESH_TOKEN_TTL_DAYS=30
AUTH_PASSWORD_MIN_LENGTH=8
AUTH_REQUIRE_OWNED_MEDIA_ACCESS=false
WEB_APP_URL=http://localhost:5173
BETTER_AUTH_URL=http://localhost:4000
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
GMAIL_SMTP_USER=ForTheBaddies-chat@gmail.com
GMAIL_SMTP_APP_PASSWORD=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
FACEBOOK_OAUTH_CLIENT_ID=
FACEBOOK_OAUTH_CLIENT_SECRET=
APPLE_OAUTH_CLIENT_ID=
APPLE_OAUTH_TEAM_ID=
APPLE_OAUTH_KEY_ID=
APPLE_OAUTH_PRIVATE_KEY=
```

Better Auth owns password identities, social accounts, verification records, and database sessions. Existing scrypt password hashes are migrated without forcing password resets. Web uses secure HTTP-only cookies; the Expo client stores its cookie in SecureStore and attaches it to API requests.

Password reset is enabled only when both `GMAIL_SMTP_USER` and `GMAIL_SMTP_APP_PASSWORD` are configured. Set `GMAIL_SMTP_USER` to the Gmail address that should send reset mail and use a Google App Password—not the normal Gmail password—for `GMAIL_SMTP_APP_PASSWORD`. Spaces in Google’s displayed App Password are accepted and removed automatically. Reset links expire after one hour and a successful reset revokes the user's other sessions. Mobile reset requests deliberately open the shared web reset page from the email so the flow works consistently across native email clients. Email verification and MFA are not enabled yet.

Google, Facebook, and Apple callbacks are handled by Better Auth at `/api/auth/callback/google`, `/api/auth/callback/facebook`, and `/api/auth/callback/apple`. Register those exact URLs in each provider dashboard. Apple requires a public HTTPS callback and uses the web Services ID as `APPLE_OAUTH_CLIENT_ID`; localhost is not accepted. Mobile social sign-in uses the Better Auth Expo authorization proxy and the `personawrapper://` app scheme; no app-maintained polling or one-time exchange-code endpoint is required.

For production:

- Set `AUTH_REQUIRED=true` so unauthenticated requests cannot create or read owned data.
- Keep media, upload, generated audio, and generated file downloads behind authenticated API requests.
- Use TLS only; keep browser sessions in HTTP-only cookies and native session cookies in SecureStore.
- Use signed URLs, authenticated download routes, or short-lived cookies for generated media/audio instead of long-lived bearer-style browser URLs.

## Production

Production should use managed PostgreSQL for application metadata and private
object storage for file/media bytes. Cloudflare R2 is the current hosted object
store and uses the existing S3-compatible storage adapter:

```env
NODE_ENV=production
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=forthebaddiez-media-production
STORAGE_S3_REGION=auto
STORAGE_S3_PREFIX=production
STORAGE_S3_ENDPOINT=https://e54c506a4049687d239b5c7909b9cee7.r2.cloudflarestorage.com
STORAGE_S3_FORCE_PATH_STYLE=false
STORAGE_S3_ACCESS_KEY_ID=<production R2 Access Key ID>
STORAGE_S3_SECRET_ACCESS_KEY=<production R2 Secret Access Key>
```

Use a distinct R2 bucket and bucket-scoped Object Read & Write token for each
environment. Prefixes organize keys but do not isolate credentials within one
R2 bucket. Keep public bucket access disabled. Full setup, CORS, lifecycle,
migration, and verification instructions are in `docs/cloudflare-r2.md`.

AWS S3 remains supported by leaving `STORAGE_S3_ENDPOINT` blank and using the
AWS SDK credential chain. If AWS S3 is selected again, prefer an app-server IAM
role scoped to the configured bucket and prefix instead of long-lived keys.

The storage service boundary is isolated in `apps/api/src/services/storageService.ts`. Both local and S3 drivers implement:

- `put`
- `get`
- `delete`
- `cleanupOlderThan`
- `healthCheck`

For production, keep object bytes outside the app container and only store stable object keys plus metadata in Postgres. This is efficient for RDS because large binary payloads do not live in database rows, backups, indexes, WAL, or query results. The current schema follows that pattern: `uploads`, `generated_media`, and `generated_audio` store `storage_key`, MIME type, byte size, ownership, expiry, and optional provider IDs while the actual bytes live in the storage driver.

Recommended cost controls:

- Use an object lifecycle rule only as a backstop for temporary uploads the API fails to clean up.
- Keep `STORAGE_S3_PREFIX` environment-specific for clear key organization, and use separate buckets/tokens for the actual environment security boundary.
- Keep metadata JSON small; store searchable values in typed columns when they become query-heavy.
- Avoid database indexes on large JSON payloads until there is a concrete query path that needs them.

## Conversation Context

Conversation turns are stored durably in Postgres. For each model request, the API sends recent turns directly, bounded by `OPENAI_MAX_CONTEXT_MESSAGES`, `OPENAI_MAX_CONTEXT_TOKENS`, and `OPENAI_MAX_CONTEXT_CHARACTERS`, and skips empty assistant messages from media-only turns so they do not waste context slots.

For longer chats, the API keeps both a compact deterministic transcript summary in
`conversations.metadata.memorySummary` and validated semantic memory in
`conversations.metadata.structuredMemory`. Structured memory records conservative,
explicit conversation preferences, conversation-scoped goals, explicit decisions or
constraints, unresolved requests, and referenced upload IDs with their original purpose. Both are prepended as system
context before the recent verbatim turns, which gives the model continuity without
resending the entire transcript every time.

Structured memory is rebuilt from persisted conversation turns when compaction runs.
It does not become global profile memory, does not infer sensitive user attributes,
and does not imply that an older referenced asset is still available to the current
provider request. Invalid structured metadata is ignored and the transcript summary
remains the fallback. The complete memory note is treated as untrusted conversation
data and shares the configured summary character and token budgets. Compaction can
also run before the message threshold when the token or character limit has already
excluded older turns.

Relevant context controls:

```env
OPENAI_MAX_CONTEXT_MESSAGES=24
OPENAI_MAX_CONTEXT_CHARACTERS=50000
OPENAI_MAX_CONTEXT_TOKENS=12000
CONVERSATION_MEMORY_SUMMARY_ENABLED=true
CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES=24
CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS=2500
CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS=800
OPENAI_STYLE_REFERENCE_SYNTHETIC_LIMIT=20
OPENAI_STYLE_REFERENCE_GOLDEN_LIMIT=5
OPENAI_STYLE_REFERENCE_MAX_TOKENS=9000
```

## Versioned policy consent

Registration requires affirmative acceptance of both the currently deployed Terms
of Use and Privacy Policy. The `users` table stores each accepted policy version and
acceptance timestamp independently:

- `terms_version_accepted` and `terms_accepted_at`
- `privacy_version_accepted` and `privacy_accepted_at`

`TERMS_POLICY_VERSION` and `PRIVACY_POLICY_VERSION` are deployment configuration,
not values supplied authoritatively by a client. The API validates registration and
re-consent against those configured versions. Increasing either version makes
existing sessions consent-stale: normal authenticated API routes return HTTP 428
until the user reviews and accepts the current policies. Session/logout and the
current-policy and acceptance endpoints remain available during that gate.

Only increase a configured version for a material policy update that should require
affirmative re-consent. Deploy the updated legal page content and version
configuration together.
