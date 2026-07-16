# Observability

The hosted development environment uses three complementary layers:

- Render health checks and deployment notifications for platform failures.
- Grafana Cloud Synthetic Monitoring for external API uptime and latency.
- OpenTelemetry sent directly from the API to Grafana Cloud for retained metrics, logs, and traces.

All OpenTelemetry export is disabled unless both `OTEL_EXPORTER_OTLP_ENDPOINT` and
`OTEL_EXPORTER_OTLP_HEADERS` are configured. A missing or unavailable telemetry
backend must not prevent the API from serving requests.

## What is collected

The API emits JSON logs to Render and keeps a bounded in-process metric snapshot. The browser sends sampled structured events to the API. Events contain operation names, paths, status codes, durations, request/trace identifiers, and sanitized error messages. They do not contain prompts, tokens, OAuth credentials, file names, message content, generated content, or provider response bodies.

Provider metrics are recorded under `provider.llm`, `provider.style_transfer`, and `provider.tts`. Import/export metrics are `data_transfer.import` and `data_transfer.export`. HTTP metrics are `http.server.request`; browser events are `client.event`.

## Development dashboard

Set `OBSERVABILITY_DASHBOARD_TOKEN` to a random value of at least 24 characters. Query the protected endpoint with a bearer token:

```sh
curl -H "Authorization: Bearer $OBSERVABILITY_DASHBOARD_TOKEN" \
  https://for-the-baddiez-api-dev.onrender.com/api/observability/metrics
```

The endpoint intentionally returns only a rolling snapshot for its running instance. Grafana Cloud is the retained source for historical debugging and latency dashboards, while Render keeps the platform's recent process logs. Filter logs by the metric operation name or by `traceId`/`requestId` to follow an individual request across browser and API events.

## Render configuration

Set the `OBSERVABILITY_DASHBOARD_TOKEN` secret in the API service before deploying this change. The blueprint enables sampled web telemetry with `VITE_TELEMETRY_ENABLED=true` and `VITE_TELEMETRY_SAMPLE_RATE=0.25`. Increase the sampling rate temporarily while investigating an issue; do not set it to `1` for production traffic unless necessary.

### Deployment and health notifications

In the Render workspace, open **Integrations > Notifications** and configure an
email destination, Slack destination, or both. Set **Default Service
Notifications** to **Only failure notifications**. This covers failed builds,
failed deploys, and running services that become unhealthy. The API already uses
`/health` as its Render health check.

If the workspace default should not apply to every service, open the API service,
go to **Settings > Notifications**, and select **Only failure notifications** as
the service override.

## Retained telemetry in Grafana Cloud

### Connect the API

1. Create or open the Grafana Cloud stack for the development environment.
2. Open **Connections**, choose **OpenTelemetry**, and select the direct OTLP
   application setup.
3. Create a Cloud Access Policy token with `metrics:write`, `logs:write`, and
   `traces:write` scopes.
4. Copy the base OTLP URL into the Render API environment variable
   `OTEL_EXPORTER_OTLP_ENDPOINT`. Use the base URL ending in `/otlp`; do not append
   `/v1/metrics`, `/v1/logs`, or `/v1/traces`.
5. Copy the generated authorization header into
   `OTEL_EXPORTER_OTLP_HEADERS`. It normally has the form
   `Authorization=Basic <encoded-credentials>`.
6. Redeploy the API. Do not put either value in `render.yaml` or commit it to Git.

The blueprint sets these non-secret values:

```text
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=for-the-baddiez-api-dev
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=development,service.namespace=for-the-baddiez
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.25
```

The API exports three application metrics with `operation` and bounded provider,
route, status, and mode attributes:

- `app_operation_count`
- `app_operation_failure_count`
- `app_operation_duration_ms`

Operations include `http.server.request`, `provider.llm`, `provider.tts`,
`provider.style_transfer`, `data_transfer.import`, `data_transfer.export`, and
`client.event`. Exported logs deliberately include only allowlisted operational
attributes; prompts, message bodies, credentials, provider responses, filenames,
and generated content are excluded.

### Verify ingestion

After redeployment, make one request to `/health` and perform one normal chat
request. Metrics are exported once per minute and may take another minute to
become searchable.

In Grafana **Explore > Metrics**, search for metrics beginning with
`app_operation`. Depending on the Grafana Prometheus conversion settings,
counters can appear with a `_total` suffix. Useful PromQL starting points are:

```promql
sum by (operation) (rate(app_operation_count_total{service_name="for-the-baddiez-api-dev"}[5m]))
```

```promql
sum by (operation) (rate(app_operation_failure_count_total{service_name="for-the-baddiez-api-dev"}[5m]))
```

For latency, use Grafana's metric builder to select
`app_operation_duration_ms` and group by `operation`. In **Explore > Logs**,
filter on the `for-the-baddiez-api-dev` service name. In **Explore > Traces**,
select the same service and inspect `HTTP GET`, `HTTP POST`, `provider.llm`,
`provider.tts`, and import/export spans.

Recommended development alerts:

- API failure ratio above 5% for 10 minutes.
- Provider failure count above 2 in 10 minutes, grouped by `operation`.
- Provider p95 latency above 60 seconds for 10 minutes.
- No metric samples from `for-the-baddiez-api-dev` for 10 minutes.

### External uptime check

In Grafana Cloud, open **Testing & synthetics > Synthetics > Checks** and create
an **API Endpoint** HTTP check with:

```text
Name: for-the-baddiez-api-dev-health
URL: https://for-the-baddiez-api-dev.onrender.com/health
Method: GET
Frequency: 1 minute
Timeout: 10 seconds
Follow redirects: enabled
Expected status: 200
Expected body text: "status":"ok"
```

Use at least two public probes in regions near likely users. Enable per-check
alerts for two failed checks within five minutes, average latency above five
seconds, and TLS certificate expiry within 21 days. Send these alerts to the same
email or Slack contact point used for operational notifications.

Also create a lightweight web check for
`https://for-the-baddiez-web-dev.onrender.com/` with an expected `200` response.
The API check is the primary service-health signal; the web check catches static
site and routing failures.

## S3 alarms

The template at `infra/cloudwatch-s3-alarms.yaml` creates 4xx and 5xx alarms for the existing media bucket. S3 only publishes request-error metrics after request metrics are enabled for the bucket. In the S3 console, create a metrics configuration with id `EntireBucket` and no filter, then deploy:

```sh
aws cloudformation deploy \
  --stack-name for-the-baddiez-s3-alarms-dev \
  --template-file infra/cloudwatch-s3-alarms.yaml \
  --parameter-overrides BucketName=forthebaddiez-media RequestMetricsFilterId=EntireBucket AlarmTopicArn=YOUR_SNS_TOPIC_ARN
```

Use a distinct stack and SNS topic per environment. S3 request metrics and CloudWatch alarms incur AWS charges; the low-volume development environment should keep the 5-minute periods and modest thresholds in the template.
