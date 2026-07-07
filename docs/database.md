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

With `DATABASE_URL` unset, the API falls back to in-memory/local-only storage so existing tests and quick local runs do not require Postgres.

With `DATABASE_URL` set, the API currently persists:

- users, password credentials, OAuth account links, and auth sessions
- conversations and messages
- upload metadata and reusable vector-store metadata
- generated-media metadata
- generated-audio metadata
- background job status, provider response IDs, and completed/failed job payloads

Uploaded file bytes, generated image/file bytes, and generated audio bytes are stored through the storage adapter. Local development uses the `local` storage driver and stores bytes on disk. Production should use the `s3` storage driver so object bytes live in S3. The database stores ownership, MIME type, filenames, size, expiration, public URLs, storage keys, and provider IDs needed to manage those objects.

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

The local app can still use the `x-owner-id` header for quick persistence when auth is not required. Once users log in, request identity should come from the bearer token middleware instead. Authenticated requests set `request.auth.userId`, and persistence helpers prefer that authenticated user ID over `x-owner-id`.

Recommended local auth defaults:

```env
AUTH_REQUIRED=false
AUTH_ACCESS_TOKEN_TTL_MINUTES=15
AUTH_REFRESH_TOKEN_TTL_DAYS=30
AUTH_PASSWORD_MIN_LENGTH=8
AUTH_REQUIRE_OWNED_MEDIA_ACCESS=false
OAUTH_REDIRECT_BASE_URL=http://localhost:4000
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
FACEBOOK_OAUTH_CLIENT_ID=
FACEBOOK_OAUTH_CLIENT_SECRET=
```

Password auth stores only password hashes. Access and refresh tokens are opaque random tokens; only token hashes are stored in Postgres. Sessions include a client type so web, desktop, iOS, and Android clients can be tracked independently.

OAuth provider tables and state storage are included in the schema so Google/Facebook sign-in can be wired without changing the core user model. The redirect/deep-link UX can be completed when the production domains and mobile callback schemes are finalized.

For production:

- Set `AUTH_REQUIRED=true` so unauthenticated requests cannot create or read owned data.
- Set `AUTH_REQUIRE_OWNED_MEDIA_ACCESS=true` after media downloads move behind authenticated or signed URLs.
- Use TLS only and store client tokens in platform-appropriate secure storage.
- Use signed URLs, authenticated download routes, or short-lived cookies for generated media/audio instead of long-lived bearer-style browser URLs.

## Production

Production should use AWS RDS PostgreSQL for the database and S3 for file/media storage. The database should store metadata for uploads, generated media, generated audio, vector stores, conversations, messages, and background jobs; object bytes should live in S3.

Production S3 storage is enabled only when `NODE_ENV=production`:

```env
NODE_ENV=production
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=persona-wrapper-prod-media
STORAGE_S3_REGION=us-east-1
STORAGE_S3_PREFIX=prod
```

Use the app server IAM role for S3 access in AWS instead of long-lived access keys. The role should be scoped to the configured bucket and prefix with permissions for:

- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:ListBucket` limited to the configured prefix

The storage service boundary is isolated in `apps/api/src/services/storageService.ts`. Both local and S3 drivers implement:

- `put`
- `get`
- `delete`
- `cleanupOlderThan`
- `healthCheck`

For production, keep object bytes outside the app container and only store stable object keys plus metadata in Postgres. This is efficient for RDS because large binary payloads do not live in database rows, backups, indexes, WAL, or query results. The current schema follows that pattern: `uploads`, `generated_media`, and `generated_audio` store `storage_key`, MIME type, byte size, ownership, expiry, and optional provider IDs while the actual bytes live in the storage driver.

Recommended cost controls:

- Use an S3 lifecycle rule to expire temporary uploads and generated media/audio that should not be retained forever.
- Keep `STORAGE_S3_PREFIX` environment-specific, for example `prod`, so cleanup and IAM can be scoped safely.
- Keep metadata JSON small; store searchable values in typed columns when they become query-heavy.
- Avoid database indexes on large JSON payloads until there is a concrete query path that needs them.

## Conversation Context

Conversation turns are stored durably in Postgres. For each model request, the API sends recent turns directly, bounded by `OPENAI_MAX_CONTEXT_MESSAGES`, `OPENAI_MAX_CONTEXT_TOKENS`, and `OPENAI_MAX_CONTEXT_CHARACTERS`, and skips empty assistant messages from media-only turns so they do not waste context slots.

For longer chats, the API keeps a compact deterministic memory summary in `conversations.metadata.memorySummary`. That summary is prepended as a system context note before the recent verbatim turns, which gives the model continuity without resending the entire transcript every time.

Relevant context controls:

```env
OPENAI_MAX_CONTEXT_MESSAGES=16
OPENAI_MAX_CONTEXT_CHARACTERS=35000
OPENAI_MAX_CONTEXT_TOKENS=8000
CONVERSATION_MEMORY_SUMMARY_ENABLED=true
CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES=16
CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS=2500
CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS=800
OPENAI_STYLE_REFERENCE_SYNTHETIC_LIMIT=20
OPENAI_STYLE_REFERENCE_GOLDEN_LIMIT=5
OPENAI_STYLE_REFERENCE_MAX_TOKENS=9000
```
