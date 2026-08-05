# Infra

Templates and policies for the AWS resources behind the app. The S3 media
bucket itself is created and managed manually (outside these templates), so
the pieces here are applied on top of the existing bucket.

## cloudwatch-s3-alarms.yaml

CloudFormation stack with CloudWatch alarms for the media bucket (5xx/4xx
error rates). Deploy with the bucket name as a parameter.

## s3-media-lifecycle.json

S3 bucket lifecycle configuration. The authoritative retention for uploads,
generated media, and generated audio lives in the API (per-object `expiresAt`
plus the scheduled `backgroundCleanupService` sweep — see
`apps/api/src/services/backgroundCleanupService.ts`). These rules are only a
backstop for objects the app never gets a chance to delete:

- `abort-incomplete-multipart-uploads` — removes abandoned multipart uploads
  bucket-wide after 7 days.
- `uploads-orphan-backstop` — expires anything under `uploads/` after 30 days.
  The app's own upload TTL (`UPLOAD_TTL_HOURS`, default 24h) is far shorter,
  so this only catches orphaned objects (for example presigned uploads that
  were never confirmed, or objects left behind by a crash).

There is deliberately **no** rule for `generated-media/` — generated images
default to `GENERATED_MEDIA_TTL_HOURS=0` (kept for the life of the
conversation) and must not be expired bucket-side.

Apply it with the AWS CLI (bucket policies can't be attached to an unmanaged
bucket via CloudFormation):

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket forthebaddiez-media \
  --lifecycle-configuration file://infra/s3-media-lifecycle.json

# verify
aws s3api get-bucket-lifecycle-configuration --bucket forthebaddiez-media
```

Two caveats when applying:

- If the API runs with a non-empty `STORAGE_S3_PREFIX`, object keys start with
  that prefix — change the rule filter to `"<prefix>/uploads/"` to match.
- If you ever set `UPLOAD_TTL_HOURS=0` (keep uploads forever), remove or
  disable the `uploads-orphan-backstop` rule, or the bucket will delete live
  attachments after 30 days.
