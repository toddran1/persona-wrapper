# Cloudflare R2 media storage

Cloudflare R2 is the hosted object store for uploads, generated media, generated
audio, artifacts, and account-transfer archives. The application continues to
use the AWS SDK's S3 protocol, so the storage driver remains named `s3` even
though the active backend is R2.

## Render configuration

The hosted development service uses these non-secret values from `render.yaml`:

```env
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=forthebaddiez-media
STORAGE_S3_REGION=auto
STORAGE_S3_PREFIX=development
STORAGE_S3_ENDPOINT=https://e54c506a4049687d239b5c7909b9cee7.r2.cloudflarestorage.com
STORAGE_S3_FORCE_PATH_STYLE=false
```

Create an R2 API token with Object Read & Write permission scoped only to the
`forthebaddiez-media` bucket. Use the S3 credentials generated for that token,
not a general Cloudflare API token or Global API Key. Add them to Render as:

```env
STORAGE_S3_ACCESS_KEY_ID=<R2 Access Key ID>
STORAGE_S3_SECRET_ACCESS_KEY=<R2 Secret Access Key>
```

Do not expose either credential to web or mobile clients. Clients receive only
short-lived, object-specific presigned PUT URLs. Keep the R2 bucket private and
leave its `r2.dev` public URL and custom-domain public access disabled. Reads
continue through owner-authenticated API routes or short-lived signed URLs.

The API identifies R2 from the endpoint, requires `region=auto`, requires an
explicit storage credential pair, and disables optional AWS SDK checksum
headers that R2 does not support. Upload completion still verifies byte size
and the file's actual MIME signature before accepting it.

## Browser upload CORS

In Cloudflare Dashboard, open **R2 Object Storage**, select
`forthebaddiez-media`, open **Settings**, then add the CORS policy from
`infra/r2-cors.json`. The rule permits only the application origins to issue
presigned PUT requests, permits only `Content-Type`, and exposes only `ETag`.

Update the future production origin in that file if the final production web
hostname differs. Native applications are not governed by browser CORS, but
they use the same signed upload path and server-side completion checks.

## Lifecycle backstop

The API owns normal retention and deletes expired objects through scheduled
cleanup. Apply `infra/r2-media-lifecycle.json` as a bucket lifecycle policy only
as a backstop for abandoned multipart uploads and unconfirmed temporary uploads.
There is intentionally no bucket expiration rule for generated media or audio.

Apply and verify the complete policy with Wrangler:

```sh
npx wrangler r2 bucket lifecycle set forthebaddiez-media --file infra/r2-media-lifecycle.json
npx wrangler r2 bucket lifecycle list forthebaddiez-media
```

R2 already creates a default rule that expires incomplete multipart uploads
after seven days. The explicit rule keeps that expectation visible in the
versioned configuration alongside the upload backstops.

If `UPLOAD_TTL_HOURS=0`, remove the upload-expiration rules before applying the
policy. If an environment uses another `STORAGE_S3_PREFIX`, update the matching
rule prefix first.

## Environment isolation

Prefixes organize keys, but an R2 bucket token scoped to a bucket can access
every prefix in that bucket. For a future production environment, use a
separate bucket such as `forthebaddiez-media-production` and a separate token
scoped only to it. Do not reuse the development token in production. This gives
development and production a real storage authorization boundary.

## Migrating existing AWS objects

Use Cloudflare Super Slurper for the one-time AWS S3 to R2 copy. Configure the
AWS bucket as the source and `forthebaddiez-media` as the target. Preserve the
existing object keys so database `storage_key` values remain valid. If AWS keys
currently omit the environment prefix, migrate them to the exact R2 keys the
database references rather than inventing a new prefix during the copy.

Recommended order:

1. Stop or briefly drain writes to AWS, or arrange a final incremental copy.
2. Copy all referenced objects with Super Slurper and skip objects already in R2.
3. Compare object counts and byte totals by prefix, then test several uploads,
   generated images, audio files, archives, and authenticated downloads.
4. Deploy the R2 environment configuration and run the admin-only
   `/health/storage` check.
5. Keep AWS read-only for a rollback window before deleting its objects or
   credentials.

Super Slurper copies object metadata but may produce different ETags, so do not
use ETag equality as the sole migration verification. The application uses
stable object keys and its own metadata rather than persisted AWS ETags.
