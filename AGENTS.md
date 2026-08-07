# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

**For the Baddiez** is an AI persona platform for conversational, multimodal
experiences (text, audio, images, charts, files, tool calls). The first built-in
persona is "LaRae the Baddest". The product is delivered as three client/server
apps plus an ML training workspace, all in one npm workspaces monorepo.

The API pipeline for a chat request is: persona engine builds the system prompt
→ LLM provider generates a neutral answer → optional style-transfer provider
re-styles it into persona voice → response formatter normalizes output →
optional TTS provider synthesizes audio.

### Monorepo layout

```text
apps/
  api/        Express API (@persona/api): persona engine, providers, auth, uploads, storage
  web/        React + Vite SPA (@persona/web): multimodal chat UI
  mobile/     Expo / React Native app (@persona/mobile), expo-router based
packages/
  shared/     Shared types, Zod schemas, and the ts-rest API contract (@persona/shared)
ml/
  style-transfer/  Python LoRA training, dataset prep, style-transfer server (RunPod)
e2e/
  web/        Playwright specs
  mobile/     Maestro flows
drizzle/      Generated Drizzle migration metadata (root-level; apps/api/drizzle holds SQL)
docs/         Design docs: database.md, data-transfer.md, observability.md, usage-plans.md, mobile-release-readiness.md
infra/        CloudWatch/S3 alarm templates and the S3 lifecycle backstop policy (see infra/README.md)
scripts/      dev.mjs (run api+web together), e2e.mjs (web e2e orchestration)
render.yaml   Render.com hosted dev environment (API, web static site, Postgres)
```

## Tech Stack

- **Runtime/language**: Node.js `^22.13.0 || >=24.3.0`, TypeScript `~6.0.3` (strict), ESM everywhere (`"type": "module"`).
- **API**: Express 4, ts-rest contract-first routes, Zod 4 validation, drizzle-orm + Postgres (pg-boss for job queues), better-auth (email + Google/Facebook OAuth, Expo support), OpenAI SDK v6 (Responses API), ElevenLabs/OpenAI/local TTS, AWS S3 SDK for media storage, OpenTelemetry observability, nodemailer (Gmail SMTP).
- **Web**: React 19, Vite 7, react-router 7, @tanstack/react-query, ts-rest client, better-auth client, react-markdown + remark-gfm, recharts.
- **Mobile**: Expo SDK ~57, react-native 0.86, expo-router, react-query (persisted via AsyncStorage), better-auth/expo, expo-audio/video/image.
- **ML**: Python 3, Unsloth/PEFT LoRA training (Qwen2.5-14B base), Ollama for dataset curation, served behind an HTTP style-transfer endpoint.
- **Tooling**: npm workspaces (npm 11.16.0), Biome 2.5 (lint only — formatter disabled), Vitest 3, Playwright, Maestro, drizzle-kit, tsx.

## Build and Run Commands

All commands run from the repo root unless noted.

```bash
npm install                 # install all workspaces

# Development
npm run dev                 # API (:4000) + web (:5173) together via concurrently
npm run dev:test            # same, with APP_TEST_MODE=true and local TTS forced
npm run dev:api             # API only (tsx watch)
npm run dev:web             # web only (vite)
npm run dev:mobile          # Expo dev server

# Database (local Postgres via docker compose, port 5434)
npm run db:up               # start postgres:16-alpine container
npm run db:migrate          # apply drizzle migrations
npm run db:generate -w @persona/api   # generate new migration from schema.ts

# Quality gates
npm run lint                # biome lint .
npm run typecheck           # builds shared, then tsc --noEmit on api, web, mobile
npm test                    # builds shared, then vitest run in api and web
npm run build               # builds shared, api (tsc), web (tsc + vite), mobile (verify)
npm run check               # lint + typecheck + test + build (full local CI)
```

**Build order matters**: `@persona/shared` is consumed from its compiled
`dist/`. After editing `packages/shared`, rebuild it
(`npm run build -w @persona/shared`) before typechecking or testing other
packages. The root `typecheck`, `test`, and `build` scripts already do this.

Environment setup: copy `apps/api/.env.example` to `apps/api/.env`. Minimum for
local dev is `PORT`; OpenAI keys are optional (the provider falls back to
deterministic stub output without a key). Mobile reads `EXPO_PUBLIC_API_URL`
(set in `apps/mobile/eas.json` build profiles).

## Testing Instructions

### Unit / integration (Vitest)

- API tests live in `apps/api/src/test/*.test.ts` (33 files); web tests under
  `apps/web/src/test` with jsdom + Testing Library.
- The API `test` script runs with `NODE_ENV=test`, empty `DATABASE_URL`,
  `AUTH_REQUIRED=false`, and `STYLE_TRANSFER_PROVIDER=stub` — unit tests must
  never require a database, auth, or paid external calls.
- Live OpenAI integration tests are opt-in and cost money; they are excluded
  from normal `npm test`:
  `npm run test:integration:openai -w @persona/api`
  (requires `OPENAI_RUN_INTEGRATION_TESTS=true` and a real key).

### E2E

- Web: `npm run test:e2e` (Playwright). `scripts/e2e.mjs` starts the Docker
  Postgres, creates an isolated `*_e2e` database, migrates, and boots API
  (:4100) + web (:5173) in test mode. `E2E_DATABASE_URL` must be localhost and
  end in `_e2e` (enforced).
- Mobile: `npm run test:e2e:mobile` (Maestro flows in `e2e/mobile/`) against a
  real device/simulator. See `e2e/mobile/README.md` for the required env setup.
- CI (`.github/workflows/ci.yml`) runs only lint → typecheck → test → build on
  Node 22.13; e2e suites run locally/on demand.

### Conventions when adding tests

- Mirror existing structure: service tests in `apps/api/src/test/`, component
  tests in `apps/web/src/test/`.
- Use the stub providers / `stubScenarioBuilder.ts` instead of mocking OpenAI
  HTTP traffic.

## Code Organization and Conventions

### API (`apps/api/src`)

- `app.ts` / `server.ts` — Express wiring, global error boundary, request IDs,
  telemetry spans. Entry point is `src/server.ts` (`tsx watch` in dev,
  `node dist/server.js` in prod).
- `routes/` → `controllers/` → `services/` layering. Route and controller logic
  stays provider-agnostic; swappable behavior belongs behind provider
  interfaces.
- `providers/llm`, `providers/tts`, `providers/styleTransfer` each define an
  interface (`LLMProvider`, `TTSProvider`, `StyleTransferProvider`), concrete
  implementations, and a `providerFactory.ts`. Register new providers in the
  factory, and add any new env vars to both `apps/api/.env.example` and
  `src/config/env.ts` (Zod-parsed env — access config only through `env.ts`).
- `personas/` — persona definitions (`larae.persona.ts`, `bambam.persona.ts`, and
  `neutral.persona.ts` — the "No persona" option, kept last in the registry so it
  never becomes the clients' default) registered in
  `personas/index.ts`. Persona-owned runtime behavior (theme tokens,
  `directResponseInstructions`, `styleReference`, `imagePromptSanitization`,
  `voiceProfile`, `neutralStyle`) must be declared in the persona profile; do
  **not** add persona-ID conditionals to providers or UI components.
  `neutralStyle: true` makes the persona engine skip all persona/style
  instructions, bypasses the style-transfer pass, and suppresses audio (TTS)
  generation for the request — the client's audio toggle state is left
  untouched so audio resumes when the user switches back to a voiced persona.
- `db/schema.ts` (drizzle) + `db/client.ts`; migrations generated with
  drizzle-kit into `apps/api/drizzle/`, applied by
  `npm run db:migrate -w @persona/api`.
- `scripts/` (API) — operational scripts run with tsx: `migrateDatabase.ts`,
  `purgeDeletedAccounts.ts`.
- The API imports workspace TS with explicit `.js` extensions (NodeNext module
  resolution) — keep that style in `apps/api`.

### Web (`apps/web/src`)

- `components/` (chat UI, output renderers, auth/legal pages), `hooks/`,
  `lib/` (ts-rest api client, authClient, queryClient, telemetry), `test/`.
- API access goes through the shared ts-rest contract (`@persona/shared`) and
  react-query; do not hand-roll fetch calls against ad-hoc endpoints.

### Mobile (`apps/mobile`)

- `app/` — expo-router screens (`_layout.tsx`, `index.tsx`, `auth/`).
- `src/` — `api/`, `components/`, `features/{auth,chat}`, `localization/`,
  `network/`, `storage/`, `theme/`.
- Release verification: `npm run verify:release -w @persona/mobile` (typecheck +
  accessibility audit). EAS builds (profiles in `eas.json`) run
  `eas-build-post-install` to build `@persona/shared` first.

### Shared (`packages/shared/src/index.ts`)

- Single source of truth for cross-app types, Zod schemas, output-item types,
  tool names, and the `apiContract` ts-rest contract. API routes
  (`contract.routes.ts`), the web client, and the mobile client all derive from
  it — change the contract here, not in individual apps.

## Code Style

- Biome is lint-only (`formatter.enabled: false`) — do not run a formatter or
  reformat files wholesale. Enforced rules: no unreachable code, no unused
  imports (error), no debugger, no `==`, no duplicate case/object keys;
  `const` and `import type` are warnings. Double quotes and semicolons are the
  convention.
- TypeScript strict mode plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` (see `tsconfig.base.json`) — handle
  `T | undefined` from indexed access and optional props precisely.
- Run `npm run check` (or at least lint + typecheck + test) before considering
  a change done; CI enforces the same.

## Security and Safety Considerations

- Never commit secrets. `.env*` files are gitignored; `OPENAI_API_KEY`,
  `ELEVENLABS_*`, OAuth secrets, AWS keys, and `BETTER_AUTH_SECRET` are managed
  via env vars / Render `sync: false` entries.
- Uploads are validated by MIME signature sniffing (`file-type`), size limits,
  and owner scoping; presigned S3 PUT is the production path, multipart
  `POST /api/uploads` is a local-dev fallback only.
- Auth is better-auth; production sets `AUTH_REQUIRED=true` and
  `AUTH_REQUIRE_OWNED_MEDIA_ACCESS=true`. Rate limits exist for chat, auth, and
  data-transfer routes — keep new sensitive endpoints behind them.
- Test mode (`APP_TEST_MODE=true`) forces the local TTS provider server-side so
  tests can never hit ElevenLabs; keep that safeguard intact.
- Persisted conversation "memory" summaries are advisory, untrusted context —
  treat them accordingly in prompts; they are deleted with the conversation.
- Datasets under `ml/style-transfer/datasets/` (raw, processed) and `trainingData/`
  are gitignored because they may contain private or licensed text — do not
  commit generated datasets or model outputs.
- Spend controls: daily estimated-spend/token limits are enforced in-process;
  don't bypass them in chat code paths.

## Deployment

- Hosted dev environment is defined in `render.yaml` (Render.com, Ohio region):
  - `for-the-baddiez-api-dev` — Node web service; builds shared + api, runs
    `db:migrate` pre-deploy, serves from `dist/server.js`, health check `/health`.
  - `for-the-baddiez-web-dev` — static site from `apps/web/dist` with SPA
    rewrite to `/index.html` and security headers.
  - `for-the-baddiez-db-dev` — managed Postgres 17.
  - Auto-deploys on commit with path-based build filters; changing the Render
    subdomain means updating all URL env vars noted in `render.yaml`.
- Mobile builds go through EAS (`apps/mobile/eas.json`: development, preview,
  testflight, production profiles).
- Local Postgres runs in Docker (`docker compose up -d postgres`, port 5434,
  db `persona_wrapper_db`).
- ML style transfer runs on RunPod pods; bootstrap scripts live in
  `ml/style-transfer/runpod/` (see root README "RunPod Development").

## Useful References

- `README.md` — full API endpoint documentation, provider/persona extension
  guides, OpenAI reliability controls and env vars.
- `ml/style-transfer/README.md` — dataset format, training, serving, and the
  style-transfer HTTP contract.
- `docs/` — database schema, data transfer (export/import), observability,
  usage plans, mobile release readiness.
