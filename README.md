# Persona Wrapper App

Production-ready starter monorepo for a fictional AI persona platform. The first built-in persona is **LaRae the Baddest**, a loud, stylish, high-drama entertainment character designed for conversational, multimodal outputs.

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

The response also includes:

- `conversationId`
- `history`
- `generatedAt`
- diagnostics such as `messageCount`

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

Included starters:

- `OpenAIProvider`
- `ClaudeProvider`
- `LocalModelProvider`
- `OpenAITTSProvider`
- `LocalTTSProvider`

They are stubbed intentionally but already shaped around typed request/response contracts.

### Tool Calling

The system includes a starter tool registry with placeholder tools for:

- web search
- file search
- data analysis
- image generation

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
- preferred voice settings
- safety boundaries

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
