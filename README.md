# For the Baddiez

For the Baddiez is an AI persona platform for conversational, multimodal experiences. The first built-in persona is **LaRae the Baddest**, a loud, stylish, high-drama entertainment character.

## Stack

- Node.js
- TypeScript
- Express API
- React + Vite frontend
- Zod validation
- dotenv configuration
- Workspace-based monorepo

## Monorepo Layout

```text
apps/
  api/      Express API, persona engine, providers, routes
  web/      React UI with multimodal rendering
packages/
  shared/   Shared types and Zod schemas
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the API example env file:

```bash
cp apps/api/.env.example apps/api/.env
```

Set at minimum:

- `PORT`
- `OPENAI_API_KEY` when you are ready to replace the stub provider with real SDK calls
- `GOOGLE_GEMINI_API_KEY` to enable Gemini responses

### Sign in with Apple

The Apple provider is enabled only when all four values below are set on the
API. The private key is used only to mint Apple's required short-lived client
secret JWT at sign-in time; do not commit the downloaded `.p8` file.

```text
APPLE_OAUTH_CLIENT_ID=com.example.for-the-baddiez.web
APPLE_OAUTH_TEAM_ID=YOUR_APPLE_TEAM_ID
APPLE_OAUTH_KEY_ID=YOUR_SIGN_IN_WITH_APPLE_KEY_ID
APPLE_OAUTH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

In Apple Developer, enable Sign in with Apple for the app's App ID, create a
Services ID for the web client, associate it with that primary App ID, and add
the production callback exactly as:

```text
https://YOUR_API_DOMAIN/api/auth/callback/apple
```

Apple requires HTTPS and will not accept a localhost callback. Use a public
TLS development domain when testing the full flow. The Services ID is
`APPLE_OAUTH_CLIENT_ID`; create a Sign in with Apple key for the same team and
store its complete `.p8` contents in `APPLE_OAUTH_PRIVATE_KEY` (literal `\n`
escapes are supported for hosts that do not preserve multiline secrets).

### 3. Run the apps

Single command:

```bash
npm run dev
```

Or separately:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Default URLs:

- API: `http://localhost:4000`
- Web: `http://localhost:5173`

## RunPod Development

RunPod rebuild scripts live in:

```text
ml/style-transfer/runpod/
```

For a fresh pod:

```bash
cd /workspace
git clone --branch develop https://github.com/toddran1/persona-wrapper.git
cd persona-wrapper
bash ml/style-transfer/runpod/bootstrap_pod.sh
bash ml/style-transfer/runpod/start_app_stack.sh
```

The default open-source LLM path uses Ollama with `llama3.2:3b` for the neutral
answer step and the Hugging Face LoRA adapter for style transfer.

## API Endpoints

### `POST /api/chat`

Example request:

```json
{
  "personaId": "larae",
  "message": "Read me for filth, but make it funny.",
  "provider": "local",
  "audio": false
}
```

The API responds with a structured multimodal payload. Output items are typed and may include:

- `text`
- `json`
- `audio`
- `image`
- `chart`
- `file`
- `tool_call`
- `tool_result`
- `source_list`
- `table`
- `code`
- `status`
- `action`

The response also includes:

- `conversationId`
- `history`
- `generatedAt`
- diagnostics such as `messageCount`

OpenAI requests use `gpt-5.4-mini` by default through the Responses API and support opt-in web search, file search,
Code Interpreter, image generation/editing, image understanding, and strict
application-owned function calls. OpenAI and Gemini share application-owned
artifact generation (`csv`, `tsv`, `xlsx`, `json`, text, Markdown, and ZIP) and
Google Maps-backed local place search. Image generation remains delegated to
OpenAI. Expensive hosted tools are enabled per request from the composer rather
than enabled globally.

### `POST /api/chat/stream`

Streams neutral OpenAI text deltas and then returns the final styled typed response
as server-sent events while preserving the existing non-streaming `POST /api/chat`
endpoint. Internal style-transfer status is never exposed to the user. The client
can abort the stream with the composer Stop button; cancellation propagates to
OpenAI and the style-transfer HTTP request.

### `POST /api/uploads/presign` and `POST /api/uploads/:id/complete`

Production clients request an owner-scoped, short-lived S3-compatible PUT URL,
upload bytes directly to Cloudflare R2, and then complete the upload through the API. Completion verifies
the object size, MIME metadata, and file signature before the asset becomes usable.
The multipart `POST /api/uploads` route remains only as the local-storage
development fallback. When OpenAI is configured, completion also creates a
short-lived OpenAI file reference.

### `POST /api/uploads/vector-stores`

Creates an expiring OpenAI vector store from uploaded asset IDs owned by the
requesting browser session.

Uploaded files are checked against supported MIME signatures, stored with a
short TTL, and deleted from OpenAI when removed or expired. Vector stores expire
after one day and can be explicitly removed with
`DELETE /api/uploads/vector-stores/:id`.

### Linked files, connected accounts, and YouTube captions

Chat messages may contain public PDF, image, audio, or video URLs. The API
downloads supported resources through the same SSRF-protected, size-bounded
resolver used for page inspection, verifies the file signature, and stores an
owner-scoped temporary copy through the configured storage driver (Cloudflare
R2 in hosted environments). The temporary asset then follows the ordinary
attachment path. Signed URL query credentials are never retained in asset
metadata.

Google Drive links can use the user's linked Google account when
`GOOGLE_DRIVE_LINK_IMPORT_ENABLED=true`. This adds the read-only Drive scope to
Google OAuth; existing users must reconnect Google and the OAuth consent screen
must be configured for that scope. Google Docs, Sheets, Slides, and Drawings are
exported to PDF or their corresponding Office format. Browser cookies are never
forwarded. Public Dropbox shared links are imported directly; private Dropbox
files and private social-media posts require a future official provider
connector or a user download/upload because those services cannot safely reuse
the user's browser session.

YouTube URLs are normalized and verified with YouTube metadata. When captions
are available, a bounded transcript is added as untrusted context so OpenAI and
other text-only providers can analyze the video's speech. Gemini continues to
receive the normalized native YouTube URI. Imported audio/video files are
transcribed for non-Gemini providers with `MEDIA_TRANSCRIPTION_MODEL`; Gemini
receives supported media directly, avoiding a duplicate transcription charge.

Relevant controls:

```text
GOOGLE_DRIVE_LINK_IMPORT_ENABLED=false
MEDIA_TRANSCRIPTION_ENABLED=true
MEDIA_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
MEDIA_TRANSCRIPTION_MAX_BYTES=25165824
UPLOAD_MAX_BYTES=49999999
UPLOAD_TTL_HOURS=24
```

## OpenAI Reliability Controls

- Recent conversation context is bounded by message count, approximate token
  count, and character count while keeping complete recent turns. Longer chats
  also get a compact persisted memory summary so continuity does not require
  resending the whole transcript.
- Hosted tools are selected automatically when the prompt clearly requires web
  search, data analysis, image generation/editing, or uploaded-document access.
- Application-owned tools remain allow-listed, use strict argument schemas,
  and include chart rendering, downloadable artifact generation, current time,
  and Google Maps-backed place search.
- Requests use retry/backoff, timeout, cancellation, per-browser rate limits,
  and an in-memory daily estimated-spend limit.
- Conversation/history state is persisted when `DATABASE_URL` is configured.
  Per-process rate and spend limits are still runtime controls.

Relevant environment variables:

```text
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
OPENAI_DAILY_SPEND_LIMIT_USD=5
OPENAI_DAILY_TOKEN_LIMIT=1000000
CHAT_RATE_LIMIT_REQUESTS=30
CHAT_RATE_LIMIT_WINDOW_MS=60000
```

When older turns leave the recent context window, the API stores a compact transcript
fallback plus validated, conversation-scoped semantic memory for explicit goals,
preferences, decisions and constraints, unresolved requests, and referenced upload IDs. This
memory is advisory, untrusted context, is deleted with the conversation, and is not promoted to
the user's global profile. The complete memory block shares the configured character and token
limits, and compaction also runs early when token or character limits exclude turns before the
normal message threshold.

The token ceiling works without pricing configuration. Set the current model
pricing environment values for spend enforcement and estimated-cost metadata
to work accurately.

## Live OpenAI Integration Tests

Normal `npm test` never makes paid OpenAI requests. To run the opt-in live suite:

```bash
npm run test:integration:openai -w @persona/api
```

The suite verifies real Responses API text, streaming, hosted web search with
sources, image understanding, application function calls, Code Interpreter,
usage, and response metadata.

### `GET /api/personas`

Returns persona summaries available to the frontend or future bots.

### `GET /api/personas/:id`

Returns the full persona definition, including voice preferences and catchphrases.

## Architecture Notes

### Persona Engine

The backend persona engine:

- loads the persona definition
- constructs the system prompt
- composes LLM input messages
- attaches tool capabilities
- delegates to an LLM provider
- normalizes the raw output via the response formatter

### Provider Adapters

LLM and TTS integrations use interfaces so you can swap implementations without changing route/controller logic.

- `LLMProvider`
- `TTSProvider`

Included providers:

- `OpenAIProvider`
- `GeminiProvider`
- `ClaudeProvider`
- `LocalModelProvider`
- `OpenAITTSProvider`
- `FishAudioTTSProvider`
- `ElevenLabsTTSProvider`
- `LocalTTSProvider`

The OpenAI provider uses the Responses API when `OPENAI_API_KEY` is configured.
The Gemini provider uses `gemini-3.5-flash-lite` through the Gemini Interactions
API by default and supports native Google Search, native code execution,
application function calls, inline supported files, application-generated
downloads, and Google Maps-backed recommendations. Requests set `store: false`; this
application's owner-scoped database remains the authoritative conversation
history instead of creating a second provider-managed history. OpenAI remains
the delegated provider for image generation and OpenAI vector stores when
Gemini is selected.
Both providers use deterministic stub output in tests and
non-production environments without their API key. Claude remains a stub, and
the local provider uses the configured Ollama endpoint.

Signed-in users choose ChatGPT or Gemini under **Settings → Provider settings**.
The choice is stored on the account and applies to new requests on web and mobile.

### Tool Calling

The system separates OpenAI-hosted tools from registered application-owned
function tools. Hosted tools include:

- web search
- file search
- data analysis
- image generation

Application-owned tools are executed server-side with strict JSON schemas and
a maximum tool-call iteration limit:

- `current_time`
- `render_chart`
- `generate_artifact`
- `places_search`

`places_search` is advertised to model providers only when `PLACES_SEARCH_ENABLED=true`,
the Places API (New) is enabled for the Google Cloud project, and
`GOOGLE_MAPS_API_KEY` is configured. Map results are also
returned as typed references so clients can expose the original Google Maps
links.

Providers can later map these definitions to native function-calling/tool-calling formats.

## Adding a New Persona

1. Create a new persona file in `apps/api/src/personas/`.
2. Export a `PersonaDefinition`.
3. Register it in `apps/api/src/personas/index.ts`.
4. The persona becomes available automatically in:
   - `GET /api/personas`
   - `GET /api/personas/:id`
   - `POST /api/chat`

Persona definition fields include:

- metadata
- fictional biography
- personality traits
- speech style
- catchphrases
- visual style
- character influences and recommendation preferences
- per-persona web/mobile theme tokens
- direct provider response instructions
- optional OpenAI style-reference dataset settings
- image-prompt sanitization replacements
- preferred voice settings and a TTS performance preset
- safety boundaries

Persona-owned runtime behavior should be declared in the profile instead of
adding persona ID checks to providers or UI components. The main extension
points are:

```ts
{
  theme: {
    background: "#0b0611",
    backgroundAlt: "#160c20",
    surface: "#21142c",
    text: "#fff8f3",
    mutedText: "#cbbbd5",
    accent: "#e0ba55",
    accentSecondary: "#6f35d9",
    border: "#463450",
    rail: "#12091a",
    danger: "#ff637d",
    chartColors: ["#e0ba55", "#8c5de8", "#ff7aa2", "#62c7b5"]
  },
  directResponseInstructions: [
    "Persona-specific model performance direction..."
  ],
  styleReference: {
    enabled: true,
    datasetKey: "persona-id",
    syntheticLimit: 8,
    goldenLimit: 4
  },
  imagePromptSanitization: {
    replacements: [
      { phrases: ["persona slang"], replaceWith: "image-safe visual wording" }
    ]
  },
  voiceProfile: {
    defaultVoiceId: "alloy",
    speakingStyle: "Concise speaking direction.",
    performancePreset: "neutral",
    fishAudio: {
      // Use either a direct referenceId or an environment-variable name.
      referenceIdEnvVar: "FISH_AUDIO_REFERENCE_ID_PERSONA",
      model: "s2.1-pro"
    },
    elevenLabs: {
      // Use either a direct voiceId or an environment-variable name.
      voiceIdEnvVar: "ELEVENLABS_VOICE_ID_PERSONA"
    }
  }
}
```

Register named TTS performance presets in
`apps/api/src/services/personaVoicePerformance.ts`. A missing or unknown preset
falls back to `neutral`. For stage media, images are required and videos are
optional; the clients use video stages only when idle, thinking, and talking
all have at least one video, otherwise they use the required stage images.

The legacy LaRae style dataset remains under `ml/style-transfer/datasets/`.
Additional persona datasets use
`ml/style-transfer/personas/<datasetKey>/{processed,curated}/`; see the
style-transfer README for the expected filenames.

## Adding a New LLM Provider

1. Create a class in `apps/api/src/providers/llm/`.
2. Implement:

```ts
interface LLMProvider {
  generateResponse(input: LLMInput): Promise<LLMOutput>;
}
```

3. Register the provider in `apps/api/src/providers/llm/providerFactory.ts`.
4. Add any new environment variables to:
   - `apps/api/.env.example`
   - `apps/api/src/config/env.ts`

## Adding a New TTS Provider

1. Create a class in `apps/api/src/providers/tts/`.
2. Implement:

```ts
interface TTSProvider {
  synthesize(input: TTSInput): Promise<TTSOutput>;
}
```

3. Register the provider in `apps/api/src/providers/tts/providerFactory.ts`.
4. Extend the persona definition if the new provider needs persona-specific voice metadata.

Set `TTS_PROVIDER=fish_audio` to use Fish Audio. Configure `FISH_AUDIO_API_KEY`
and, for stable persona voices, a per-persona `FISH_AUDIO_REFERENCE_ID_*` value.
The reference ID is the Fish Audio voice model ID; if it is omitted, Fish Audio
uses its default voice. App-deliverable Fish output is limited to MP3, WAV, and
Opus; raw PCM is rejected because the web and mobile players require a playable
container. Successful responses are MIME-, signature-, and size-validated
before storage. Automatic retries are limited to explicit 425/429 responses,
honor `Retry-After`, and are capped by `FISH_AUDIO_RETRY_MAX_MS` to avoid
duplicating potentially billable synthesis after an ambiguous transport or
server failure. The Fish adapter exposes the documented S2.1 request controls
for sampling (`TEMPERATURE`, `TOP_P`), output and chunking (`FORMAT`, sample and
bit rates, `CHUNK_LENGTH`, `MIN_CHUNK_LENGTH`, `MAX_NEW_TOKENS`), continuity
(`CONDITION_ON_PREVIOUS_CHUNKS`, `REPETITION_PENALTY`, `EARLY_STOP_THRESHOLD`),
normalization, prosody, latency, and request features such as `quality-guard`.
Persona `voiceProfile.fishAudio` fields can override these defaults. When
`OPENAI_TTS_SCRIPT_ENABLED=true`, audio requests produce separate visible text
and a hidden Fish-optimized narration script; S2 bracket cues and emoji cleanup
apply only to the hidden script. With `TTS_AUDIT_LOG_ENABLED=true`, the final
speech script and non-secret Fish request settings are stored in the private
`generated_audio.metadata` record in full for up to the generated-audio retention
period; they are never returned by the app API. ElevenLabs and OpenAI remain
selectable adapters.

## Future Bot / Media Expansion

The current structure is ready for future packages or apps such as:

- Telegram bot transport
- TikTok / YouTube Shorts script generator
- TTS/audio rendering workers
- image/video generation pipelines
- retrieval and memory layers

Those should consume the same shared types and persona engine contracts instead of duplicating persona logic.

## Replacing Stubbed Providers With Real SDK Calls

The provider classes are already the right insertion point for real integrations.

For OpenAI, the expected path is:

1. install the SDK in `apps/api`
2. initialize the client inside `OpenAIProvider`
3. map `LLMInput` to the SDK message/tool schema
4. map SDK output back into `LLMOutput`
5. keep `ResponseFormatter` as the final normalization boundary

## Fine-Tuning an Open-Source Model With LoRA / QLoRA Later

This repo does not fine-tune models directly yet, but the cleanest future path is:

1. Build a persona dataset from approved example dialogue, style examples, refusals, and content boundaries.
2. Format that data into instruction-tuning examples:
   - system prompt
   - user input
   - ideal persona response
3. Choose a base instruct model that matches your latency and deployment budget.
4. Fine-tune with:
   - **LoRA** for lighter adapter training
   - **QLoRA** when GPU memory is limited and 4-bit quantization is useful
5. Store the adapter and inference settings separately from the app code.
6. Add a new `LocalModelProvider` implementation that loads the merged model or adapter-backed inference server.
7. Keep persona metadata in code even after fine-tuning, because product logic still needs:
   - persona discovery
   - voice preferences
   - frontend display data
   - safety boundaries
   - tool availability

Recommended future training stack:

- Hugging Face Transformers
- PEFT
- bitsandbytes
- TRL or a custom supervised fine-tuning pipeline

## Production Readiness Notes

This starter includes:

- strong shared typing
- request validation
- explicit provider boundaries
- in-memory conversation state for MVP iteration
- extensible tool contracts
- multimodal output rendering
- environment parsing
- centralized formatting and error handling

Before deploying, add:

- authentication and rate limiting
- persistent conversation storage
- observability and tracing
- real provider SDK calls
- secret management
- test coverage
- CI/CD
