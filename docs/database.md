# Database Setup

The app uses PostgreSQL for durable application state. Local development uses Docker Compose and stores the Postgres data directory on the external SSD path:

```text
/Volumes/ReggieSSD/mac/postgres/persona_wrapper_db
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

- conversations and messages
- upload metadata and reusable vector-store metadata
- generated-audio metadata
- background job status, provider response IDs, and completed/failed job payloads

Uploaded file bytes and generated audio bytes are still stored on local disk in development. The database stores the ownership, MIME type, filenames, size, expiration, and provider IDs needed to manage those files.

Active OpenAI background polling and cancel controllers are still runtime process state for now. The database-backed job record is there so polling, status checks, and completed results are still available even when the original in-memory job map is gone.

## Production

Production should use AWS RDS PostgreSQL for the database and S3 for file/media storage. The database should store metadata for uploads, generated audio, vector stores, conversations, messages, and background jobs; object bytes should live in S3.
