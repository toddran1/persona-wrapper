# Observability

## What is collected

The API emits JSON logs to Render and keeps a bounded in-process metric snapshot. The browser sends sampled structured events to the API. Events contain operation names, paths, status codes, durations, request/trace identifiers, and sanitized error messages. They do not contain prompts, tokens, OAuth credentials, file names, message content, generated content, or provider response bodies.

Provider metrics are recorded under `provider.llm`, `provider.style_transfer`, and `provider.tts`. Import/export metrics are `data_transfer.import` and `data_transfer.export`. HTTP metrics are `http.server.request`; browser events are `client.event`.

## Development dashboard

Set `OBSERVABILITY_DASHBOARD_TOKEN` to a random value of at least 24 characters. Query the protected endpoint with a bearer token:

```sh
curl -H "Authorization: Bearer $OBSERVABILITY_DASHBOARD_TOKEN" \
  https://for-the-baddiez-api-dev.onrender.com/api/observability/metrics
```

The endpoint intentionally returns only a rolling snapshot for its running instance. Render JSON logs remain the durable source for debugging and latency dashboards. In Render, filter messages by the metric operation name or by `traceId`/`requestId` to follow an individual request across browser and API events.

## Render configuration

Set the `OBSERVABILITY_DASHBOARD_TOKEN` secret in the API service before deploying this change. The blueprint enables sampled web telemetry with `VITE_TELEMETRY_ENABLED=true` and `VITE_TELEMETRY_SAMPLE_RATE=0.25`. Increase the sampling rate temporarily while investigating an issue; do not set it to `1` for production traffic unless necessary.

## S3 alarms

The template at `infra/cloudwatch-s3-alarms.yaml` creates 4xx and 5xx alarms for the existing media bucket. S3 only publishes request-error metrics after request metrics are enabled for the bucket. In the S3 console, create a metrics configuration with id `EntireBucket` and no filter, then deploy:

```sh
aws cloudformation deploy \
  --stack-name for-the-baddiez-s3-alarms-dev \
  --template-file infra/cloudwatch-s3-alarms.yaml \
  --parameter-overrides BucketName=forthebaddiez-media RequestMetricsFilterId=EntireBucket AlarmTopicArn=YOUR_SNS_TOPIC_ARN
```

Use a distinct stack and SNS topic per environment. S3 request metrics and CloudWatch alarms incur AWS charges; the low-volume development environment should keep the 5-minute periods and modest thresholds in the template.
