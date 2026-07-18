# Account data transfer

Large account imports and exports run as durable `pg-boss` jobs. Web and mobile clients display job phase and progress, can cancel active work, and download completed exports as authenticated ZIP archives. Completed job records and stored source/result archives expire after `DATA_TRANSFER_JOB_TTL_HOURS` (24 hours by default).

## Export ZIP format

For the Baddiez exports use a version 2 ZIP container:

- `manifest.json` identifies the format, scope, conversation shards, checksums, and media paths.
- `account.json` contains the portable account profile when the export scope is the full account.
- `conversations-000.json`, `conversations-001.json`, and later shards contain up to 250 portable conversations each.
- `media/<kind>/<source-id>/<file-name>` contains available uploads, generated media, audio, and artifacts.

The archive intentionally stores conversations only once. Import reconstructs the version 1 portable JSON envelope internally so existing portable-format validation remains compatible.

## Compatible imports

Import accepts:

- For the Baddiez version 1 JSON exports and version 2 ZIP exports.
- JSONL files containing one exported conversation object per line.
- ChatGPT `conversations.json` or numbered `conversations-000.json` files, including top-level `file_*.dat` assets when present.
- Claude conversation JSON containing `chat_messages` or `messages`, either as an array or under a `conversations` property.

OpenAI and Anthropic document how users request and download exports, but neither publishes a guaranteed, versioned JSON import schema. These external adapters are therefore defensive, best-effort compatibility layers. Keep anonymized real export fixtures in tests whenever either provider changes its archive structure. See [OpenAI data export](https://help.openai.com/en/articles/7260999-how-do-i-export-my-data) and [Claude data export](https://support.claude.com/en/articles/9450526-export-your-claude-data).

Claude currently documents export, but does not support importing a personal Claude export into another Claude account. Claude support here means importing Claude's exported conversations into For the Baddiez.

## Safety and atomicity

- S3 deployments upload archives directly with presigned PUT URLs. Local development falls back to an in-memory multipart endpoint capped at 64 MiB.
- Compressed and expanded archive sizes are bounded by `DATA_TRANSFER_ARCHIVE_MAX_BYTES`.
- ZIP entry count, CRC, expanded size, and file names are validated before import.
- A SHA-256 digest skips an already completed copy of the same archive.
- Conversation fingerprints and media SHA-256 values skip duplicates across different archives.
- Each import uses a per-user PostgreSQL advisory lock and one database transaction. Any conversation or media database failure rolls back the entire import, and staged objects are deleted.
- Export downloads require the owning authenticated session. Account deletion and scheduled cleanup remove source and result objects.

The current ZIP implementation buffers archives in the worker process. Keep the configured limit below the worker's available memory; introduce streaming ZIP/S3 multipart I/O before raising it into multi-gigabyte territory.
