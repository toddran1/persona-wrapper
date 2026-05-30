"""Transcribe YouTube audio with faster-whisper.

This uses the video's actual audio instead of YouTube captions, so profanity is
only censored if it is censored in the audio itself.

Example:

    python3 ml/style-transfer/scripts/transcribe_youtube_audio.py \
      "https://www.youtube.com/watch?v=VSqQFPDtgIs&t=13s" \
      --output ml/style-transfer/datasets/raw/other/VIDEO.txt
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AUDIO_DIR = ROOT / "ml/style-transfer/datasets/raw/audio"
DEFAULT_OUTPUT_DIR = ROOT / "ml/style-transfer/datasets/raw/other"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="YouTube video URL.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Transcript output path. Defaults to raw/other/<video-title>.txt.",
    )
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR)
    parser.add_argument("--model-size", default="large-v3")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument(
        "--compute-type",
        default="auto",
        help="faster-whisper compute type, e.g. auto, int8, float16.",
    )
    parser.add_argument("--language", default="en")
    parser.add_argument(
        "--with-timestamps",
        action="store_true",
        help="Write [start -> end] timestamps before each segment.",
    )
    return parser.parse_args()


def safe_stem(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value.strip(), flags=re.ASCII)
    value = re.sub(r"_+", "_", value).strip("_.")
    return value[:120] or "youtube_transcript"


def download_audio(url: str, audio_dir: Path) -> tuple[Path, dict[str, Any]]:
    try:
        import yt_dlp
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: yt-dlp. Install with: pip install yt-dlp"
        ) from exc

    audio_dir.mkdir(parents=True, exist_ok=True)
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(audio_dir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": False,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
    }

    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        prepared = Path(ydl.prepare_filename(info))
        audio_path = prepared.with_suffix(".wav")
        if not audio_path.exists():
            raise FileNotFoundError(f"Expected extracted audio at {audio_path}")
        return audio_path, info


def transcribe(audio_path: Path, args: argparse.Namespace) -> list[tuple[float, float, str]]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: faster-whisper. Install with: pip install faster-whisper"
        ) from exc

    model = WhisperModel(
        args.model_size,
        device=args.device,
        compute_type=args.compute_type,
    )
    segments, _info = model.transcribe(
        str(audio_path),
        language=args.language,
        vad_filter=True,
        beam_size=5,
    )

    transcript: list[tuple[float, float, str]] = []
    for segment in segments:
        text = re.sub(r"\s+", " ", segment.text).strip()
        if text:
            transcript.append((float(segment.start), float(segment.end), text))
    return transcript


def write_transcript(
    segments: list[tuple[float, float, str]],
    output_path: Path,
    with_timestamps: bool,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for start, end, text in segments:
        if with_timestamps:
            lines.append(f"[{start:0.2f} -> {end:0.2f}] {text}")
        else:
            lines.append(text)
    output_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def main() -> None:
    args = parse_args()
    audio_path, info = download_audio(args.url, args.audio_dir)
    title = str(info.get("title") or info.get("id") or "youtube_transcript")
    output_path = args.output or (DEFAULT_OUTPUT_DIR / f"{safe_stem(title)}.txt")
    segments = transcribe(audio_path, args)
    write_transcript(segments, output_path, args.with_timestamps)
    print(f"Audio: {audio_path}")
    print(f"Transcript: {output_path}")
    print(f"Segments: {len(segments)}")


if __name__ == "__main__":
    main()
