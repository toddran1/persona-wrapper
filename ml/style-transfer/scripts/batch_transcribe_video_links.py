"""Batch transcribe video links listed as "LABEL: URL" lines.

Example:

    python3 ml/style-transfer/scripts/batch_transcribe_video_links.py \
      video_links.txt \
      --impersonate chrome \
      --device cuda \
      --compute-type float16
"""

from __future__ import annotations

import argparse
from pathlib import Path
from types import SimpleNamespace

from transcribe_youtube_audio import (
    DEFAULT_AUDIO_DIR,
    DEFAULT_OUTPUT_DIR,
    download_audio,
    transcribe,
    write_transcript,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("links_file", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR)
    parser.add_argument("--model-size", default="large-v3")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--compute-type", default="auto")
    parser.add_argument("--language", default="en")
    parser.add_argument("--with-timestamps", action="store_true")
    parser.add_argument("--cookies", type=Path)
    parser.add_argument("--cookies-from-browser")
    parser.add_argument("--impersonate")
    parser.add_argument(
        "--js-runtime",
        action="append",
        help="yt-dlp JavaScript runtime, e.g. node:/usr/bin/node. Can be repeated.",
    )
    parser.add_argument(
        "--remote-component",
        action="append",
        help="Allow a yt-dlp remote component, e.g. ejs:github. Can be repeated.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Do not regenerate transcript files that already exist.",
    )
    return parser.parse_args()


def iter_links(path: Path) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ValueError(f"{path}:{line_number} must use 'LABEL: URL' format")
        label, url = line.split(":", 1)
        label = label.strip()
        url = url.strip()
        if not label or not url:
            raise ValueError(f"{path}:{line_number} must include both label and URL")
        links.append((label, url))
    return links


def main() -> None:
    args = parse_args()
    links = iter_links(args.links_file)
    transcribe_args = SimpleNamespace(
        model_size=args.model_size,
        device=args.device,
        compute_type=args.compute_type,
        language=args.language,
    )

    successes = 0
    failures = 0
    for index, (label, url) in enumerate(links, 1):
        output_path = args.output_dir / f"{label}.txt"
        print(f"[{index}/{len(links)}] {label}: {url}")
        if args.skip_existing and output_path.exists():
            print(f"  skip existing: {output_path}")
            continue
        try:
            audio_path, _info = download_audio(
                url,
                args.audio_dir,
                cookies=args.cookies,
                cookies_from_browser=args.cookies_from_browser,
                impersonate=args.impersonate,
                js_runtime=args.js_runtime,
                remote_component=args.remote_component,
            )
            segments = transcribe(audio_path, transcribe_args)
            write_transcript(segments, output_path, args.with_timestamps)
        except Exception as exc:
            failures += 1
            print(f"  failed: {exc}")
            continue
        successes += 1
        print(f"  wrote: {output_path} ({len(segments)} segments)")

    print(f"Done. Successes: {successes}. Failures: {failures}.")


if __name__ == "__main__":
    main()
