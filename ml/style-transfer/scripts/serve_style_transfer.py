"""Serve a LoRA style-transfer adapter over HTTP.

Example:

    python3 ml/style-transfer/scripts/serve_style_transfer.py \
      --adapter toddran1/larae-style-transfer-qwen2p5-14b-uncensored-lora-v1-pairs-newdata \
      --host 0.0.0.0 \
      --port 8000
"""

from __future__ import annotations

import argparse
import re
from difflib import SequenceMatcher
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field
from unsloth import FastLanguageModel


DEFAULT_ADAPTER = "toddran1/larae-style-transfer-qwen2p5-14b-uncensored-lora-v1-pairs-newdata"
PROTECTED_NAME_PATTERN = re.compile(
    r"\b(?:[A-Z][A-Za-z0-9&'-]*|[A-Z]{2,})"
    r"(?:\s+(?:at|of|the|and|a|an|in|to|&|[A-Z][A-Za-z0-9&'-]*|[A-Z]{2,}))*"
)
PROTECTED_NAME_HINTS = {
    "botanic",
    "botanical",
    "museum",
    "plaza",
    "stadium",
    "park",
    "garden",
    "gardens",
    "conservatory",
    "team",
    "cowboys",
    "dallas",
    "texas",
    "bible",
    "genesis",
}
PROFANITY_PATTERN = re.compile(
    r"\b(?:motherfucker|motherfucking|fucking|fuck|bitch|shit|ass|hoe)\b",
    re.IGNORECASE,
)
VENUE_WORDS = {
    "aquarium",
    "arena",
    "botanic",
    "botanical",
    "casino",
    "center",
    "conservatory",
    "garden",
    "gardens",
    "hall",
    "hotel",
    "museum",
    "park",
    "plaza",
    "resort",
    "stadium",
    "theater",
    "theatre",
}
NAME_CONNECTOR_WORDS = {"a", "an", "and", "at", "in", "of", "on", "the", "to"}
LEADING_NON_NAME_WORDS = {"check", "consider", "explore", "go", "hit", "see", "try", "visit"}
TRAILING_NON_NAME_WORDS = {"a", "an", "and", "at", "in", "of", "on", "the", "to"}
STYLE_NAME_FILLER_WORDS = {
    "badass",
    "baddass",
    "baby",
    "bitch",
    "bitchy",
    "damn",
    "fuck",
    "fucking",
    "motherfucker",
    "motherfucking",
}
PROTECTED_LITERAL_PATTERN = re.compile(
    r"\b(?:19|20)\d{2}\b|"
    r"\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b|"
    r"\b\d{1,2}\s*(?:AM|PM|am|pm)\b|"
    r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+"
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+"
    r"\d{1,2},?\s+\d{4}\b|"
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+"
    r"\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|"
    r"\b\d+(?:\.\d+)?\s*(?:°\s*)?(?:C|F|Celsius|Fahrenheit)\b|"
    r"\b\d+(?:\.\d+)?\s*(?:minutes?|hours?|days?|weeks?|months?|years?)\b|"
    r"\$\d+(?:,\d{3})*(?:\.\d{2})?\b|"
    r"\b\d+(?:\.\d+)?%\b",
    re.IGNORECASE,
)
VERBATIM_REQUEST_PATTERN = re.compile(
    r"\b(exactly as is|verbatim|word for word|quote|quoted|first\s+\d+\s+(?:lines?|sentences?|verses?|paragraphs?)|"
    r"bible|scripture|verse|verses|chapter|book of|speech|lyrics?|poem)\b",
    re.IGNORECASE,
)
NUMBERED_LINE_PATTERN = re.compile(r"^\s*\d+[\).]?\s*.+", re.MULTILINE)
QUOTED_SPAN_PATTERN = re.compile(r"([\"“][^\"”]+[\"”])", re.DOTALL)
GENERATED_QUOTED_SPAN_PATTERN = re.compile(r"([\"“'‘][^\"”'’]+[\"”'’])", re.DOTALL)
REFUSAL_PATTERN = re.compile(
    r"\b(i\s+can(?:not|'t)|i\s+won(?:not|'t)|unable to|can't fulfill|cannot fulfill|not able to)\b",
    re.IGNORECASE,
)
UNCERTAIN_NEUTRAL_PATTERN = re.compile(
    r"\b("
    r"i\s+could(?:\s+not|n't)\s+find|"
    r"could(?:\s+not|n't)\s+find|"
    r"i\s+do\s+not\s+have|i\s+don't\s+have|"
    r"not\s+available|not\s+publicly\s+available|"
    r"no\s+reliable|no\s+information|"
    r"does\s+not\s+contain|do\s+not\s+contain|"
    r"not\s+yet\s+occurred|"
    r"cannot\s+verify|can't\s+verify|"
    r"exact\s+wording"
    r")\b",
    re.IGNORECASE,
)
MIN_DYNAMIC_NEW_TOKENS = 96
DYNAMIC_TOKEN_MULTIPLIER = 1.4
DYNAMIC_TOKEN_BUFFER = 64
MAX_OUTPUT_CHAR_RATIO = 2.4
MAX_OUTPUT_CHAR_BUFFER = 300


class StyleTransferRequest(BaseModel):
    neutralText: str = Field(min_length=1)
    personaId: str | None = None
    userMessage: str | None = None
    conversationHistory: list[dict[str, Any]] = Field(default_factory=list)
    sourceProvider: str | None = None
    modelId: str | None = None


class StyleTransferResponse(BaseModel):
    styledText: str
    metadata: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", default=DEFAULT_ADAPTER)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    parser.add_argument("--max-new-tokens", type=int, default=800)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--repetition-penalty", type=float, default=1.18)
    parser.add_argument("--no-repeat-ngram-size", type=int, default=4)
    return parser.parse_args()


def should_protect_name(candidate: str) -> bool:
    if len(candidate.strip()) <= 1:
        return False

    words = candidate.split()
    lowered_words = {word.lower().strip(".,:;!?") for word in words}
    title_words = [word for word in words if word[:1].isupper() and word.lower() not in {"at", "of", "the", "and"}]
    if len(words) >= 2 and (lowered_words & (PROTECTED_NAME_HINTS | VENUE_WORDS)):
        return True
    if len(title_words) >= 2 and len(words) <= 4:
        return True
    lowered = candidate.lower()
    return candidate.isupper() or "&" in candidate or lowered in PROTECTED_NAME_HINTS


def clean_protected_name_candidate(candidate: str) -> str:
    words = candidate.strip(" ,.:;!?").split()
    while words and words[0].lower().strip(" ,.:;!?") in LEADING_NON_NAME_WORDS:
        words = words[1:]
    while words and words[-1].lower().strip(" ,.:;!?") in TRAILING_NON_NAME_WORDS:
        words = words[:-1]
    return " ".join(words).strip(" ,.:;!?")


def extract_protected_names(text: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for match in PROTECTED_NAME_PATTERN.finditer(text):
        candidate = clean_protected_name_candidate(match.group(0))
        if candidate.upper() in {"AM", "PM"}:
            continue
        if not candidate or not should_protect_name(candidate):
            continue
        key = candidate.lower()
        if key in seen:
            continue
        names.append(candidate)
        seen.add(key)
    return names


def protected_names_prompt(names: list[str]) -> str:
    if not names:
        return ""
    protected = "\n".join(f"- {name}" for name in names)
    return (
        "Protected names that must be copied exactly if mentioned. Do not rename, replace, "
        "paraphrase, split, or insert profanity into these names:\n"
        f"{protected}\n\n"
    )


def extract_protected_literals(text: str) -> list[str]:
    literals: list[str] = []
    seen: set[str] = set()
    for match in PROTECTED_LITERAL_PATTERN.finditer(text):
        literal = match.group(0).strip()
        key = literal.lower()
        if not literal or key in seen:
            continue
        literals.append(literal)
        seen.add(key)
    return literals


def protected_literals_prompt(literals: list[str]) -> str:
    if not literals:
        return ""
    protected = "\n".join(f"- {literal}" for literal in literals)
    return (
        "Protected dates, times, numbers, measurements, and amounts that must be copied exactly "
        "if mentioned. Do not spell them out, rewrite them, approximate them, or change formatting:\n"
        f"{protected}\n\n"
    )


def restore_literal_case(text: str, literal: str) -> str:
    return re.sub(re.escape(literal), literal, text, flags=re.IGNORECASE)


def restore_time_literal(text: str, literal: str) -> str:
    time_match = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$", literal)
    if not time_match:
        return text

    hour = time_match.group(1)
    suffix = time_match.group(3)
    suffix_pattern = rf"\s*{suffix}" if suffix else r"(?:\s*(?:AM|PM|am|pm))?"
    corrupted_time_pattern = re.compile(rf"\b{re.escape(hour)}:[0-9oO]{{2}}{suffix_pattern}\b", re.IGNORECASE)
    if corrupted_time_pattern.search(text):
        return corrupted_time_pattern.sub(literal, text, count=1)

    hour_only_pattern = re.compile(rf"\b{re.escape(hour)}{suffix_pattern}\b", re.IGNORECASE)
    return hour_only_pattern.sub(literal, text, count=1)


def restore_month_date_literal(text: str, literal: str) -> str:
    month_match = re.match(
        r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
        r"\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}$",
        literal,
        re.IGNORECASE,
    )
    if not month_match:
        return text

    month = month_match.group(1)
    pattern = re.compile(
        rf"\b{re.escape(month)}\s+(?:\d{{1,2}}(?:st|nd|rd|th)?,?\s+)?\d{{4}}\b",
        re.IGNORECASE,
    )
    return pattern.sub(literal, text, count=1)


def restore_protected_literals(text: str, literals: list[str]) -> str:
    restored = text
    for literal in sorted(literals, key=len, reverse=True):
        if re.search(re.escape(literal), restored, re.IGNORECASE):
            restored = restore_literal_case(restored, literal)
            continue

        updated = restore_time_literal(restored, literal)
        if updated != restored:
            restored = updated
            continue

        updated = restore_month_date_literal(restored, literal)
        if updated != restored:
            restored = updated

    return restored


def should_preserve_verbatim_content(user_message: str | None, neutral_text: str) -> bool:
    combined = f"{user_message or ''}\n{neutral_text}"
    return bool(VERBATIM_REQUEST_PATTERN.search(combined))


def extract_verbatim_blocks(neutral_text: str) -> list[str]:
    blocks: list[str] = []
    seen: set[str] = set()

    numbered_lines = [match.group(0).strip() for match in NUMBERED_LINE_PATTERN.finditer(neutral_text)]
    if numbered_lines:
        numbered_block = "\n".join(numbered_lines)
        blocks.append(numbered_block)
        seen.add(numbered_block)

    for match in QUOTED_SPAN_PATTERN.finditer(neutral_text):
        block = match.group(1).strip()
        if block and block not in seen:
            blocks.append(block)
            seen.add(block)

    return blocks


def verbatim_blocks_prompt(blocks: list[str]) -> str:
    if not blocks:
        return ""

    protected = "\n\n".join(f"PROTECTED VERBATIM BLOCK {index + 1}:\n{block}" for index, block in enumerate(blocks))
    return (
        "Protected verbatim text that must be copied exactly if included. Do not rewrite, paraphrase, "
        "summarize, modernize, add profanity inside, change capitalization, change punctuation, change "
        "book names, change speaker names, change verse lines, or change quoted wording:\n"
        f"{protected}\n\n"
    )


def replace_numbered_lines_with_neutral(styled_text: str, neutral_text: str) -> str:
    neutral_lines = [match.group(0).strip() for match in NUMBERED_LINE_PATTERN.finditer(neutral_text)]
    if not neutral_lines:
        return styled_text

    styled_lines = styled_text.splitlines()
    neutral_index = 0
    replaced_lines: list[str] = []

    for line in styled_lines:
        if neutral_index < len(neutral_lines) and NUMBERED_LINE_PATTERN.match(line):
            replaced_lines.append(neutral_lines[neutral_index])
            neutral_index += 1
        else:
            replaced_lines.append(line)

    if neutral_index == 0:
        return styled_text.rstrip() + "\n\n" + "\n".join(neutral_lines)

    if neutral_index < len(neutral_lines):
        replaced_lines.append("")
        replaced_lines.extend(neutral_lines[neutral_index:])

    return "\n".join(replaced_lines).strip()


def restore_verbatim_blocks(styled_text: str, neutral_text: str, blocks: list[str]) -> str:
    restored = replace_numbered_lines_with_neutral(styled_text, neutral_text)

    for block in blocks:
        if block in restored:
            continue

        if block in neutral_text and block.startswith(('"', "“")):
            if GENERATED_QUOTED_SPAN_PATTERN.search(restored):
                restored = GENERATED_QUOTED_SPAN_PATTERN.sub(block, restored, count=1)
            else:
                quote_positions = [position for position in (restored.find(mark) for mark in ['"', "“", "'", "‘"]) if position >= 0]
                if quote_positions:
                    restored = restored[: min(quote_positions)].rstrip() + " " + block
                else:
                    restored = restored.rstrip() + "\n\n" + block

    return restored


def should_bypass_style_for_empty_verbatim_request(neutral_text: str, blocks: list[str]) -> bool:
    return not blocks and bool(REFUSAL_PATTERN.search(neutral_text))


def should_conservatively_style_uncertain_answer(neutral_text: str) -> bool:
    return bool(UNCERTAIN_NEUTRAL_PATTERN.search(neutral_text))


def estimate_dynamic_max_new_tokens(tokenizer: Any, neutral_text: str, configured_max: int) -> int:
    neutral_token_count = len(tokenizer.encode(neutral_text, add_special_tokens=False))
    dynamic_limit = int(neutral_token_count * DYNAMIC_TOKEN_MULTIPLIER) + DYNAMIC_TOKEN_BUFFER
    return min(configured_max, max(MIN_DYNAMIC_NEW_TOKENS, dynamic_limit))


def is_runaway_output(styled_text: str, neutral_text: str) -> bool:
    if len(styled_text) <= len(neutral_text) + MAX_OUTPUT_CHAR_BUFFER:
        return False

    return len(styled_text) > int(len(neutral_text) * MAX_OUTPUT_CHAR_RATIO) + MAX_OUTPUT_CHAR_BUFFER


def conservative_uncertainty_style(neutral_text: str) -> str:
    text = neutral_text.strip()
    replacements = [
        ("I couldn't ", "Look, I couldn't "),
        ("I could not ", "Look, I could not "),
        ("I don't have ", "Look, I don't have "),
        ("I do not have ", "Look, I do not have "),
        ("Unfortunately, ", "Look, "),
        ("However, ", "But "),
        ("It is possible that ", "It might be that "),
    ]
    for source, target in replacements:
        text = text.replace(source, target, 1)

    if text == neutral_text.strip():
        text = f"Look, {text[:1].lower()}{text[1:]}" if text else text

    return text


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def strip_profanity(value: str) -> str:
    cleaned = PROFANITY_PATTERN.sub("", value)
    return re.sub(r"\s{2,}", " ", cleaned).strip(" ,.-")


def restore_compacted_names(text: str, names: list[str]) -> str:
    restored = text
    word_span_pattern = re.compile(r"\b[A-Za-z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z][A-Za-z0-9&'.-]*){0,5}\b")
    for name in sorted(names, key=len, reverse=True):
        normalized_name = normalize_name(name)
        if len(normalized_name) < 8 or re.search(re.escape(name), restored, re.IGNORECASE):
            continue

        compact_pattern = re.compile(r"\b" + r"\s*".join(re.escape(word) for word in name.split()) + r"\b", re.IGNORECASE)
        restored = compact_pattern.sub(name, restored, count=1)
        if re.search(re.escape(name), restored):
            continue

        for match in word_span_pattern.finditer(restored):
            candidate = strip_profanity(match.group(0))
            if SequenceMatcher(None, normalize_name(candidate), normalized_name).ratio() >= 0.86:
                restored = restored[: match.start()] + name + restored[match.end() :]
                break
    return restored


def restore_venue_names(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = name.split()
        if len(words) < 2:
            continue

        exact_pattern = re.compile(re.escape(name), re.IGNORECASE)
        restored = exact_pattern.sub(name, restored)
        if re.search(re.escape(name), restored):
            continue

        venue_words = [word for word in reversed(words) if word.lower() in VENUE_WORDS]
        if not venue_words:
            continue

        for venue_word in venue_words:
            pattern = re.compile(
                rf"\b{re.escape(words[0])}\b(?:\s+\S+){{0,8}}\s+\b{re.escape(venue_word)}\b",
                re.IGNORECASE,
            )
            match = pattern.search(restored)
            if not match:
                continue

            candidate = strip_profanity(match.group(0))
            if SequenceMatcher(None, normalize_name(candidate), normalize_name(name)).ratio() >= 0.45:
                restored = restored[: match.start()] + name + restored[match.end() :]
                break
    return restored


def restore_shortened_names(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = [word for word in name.split() if word.lower() not in {"at", "of", "the", "and"}]
        if len(words) < 3 or re.search(re.escape(name), restored, re.IGNORECASE):
            continue

        alias = " ".join(words[:2])
        alias_pattern = re.compile(re.escape(alias), re.IGNORECASE)
        if alias_pattern.search(restored):
            restored = alias_pattern.sub(name, restored, count=1)
    return restored


def meaningful_name_tokens(value: str) -> set[str]:
    tokens = set()
    for token in re.findall(r"[A-Za-z][A-Za-z&'-]*", value.lower()):
        cleaned = token.strip("&'-")
        if len(cleaned) < 3 or cleaned in NAME_CONNECTOR_WORDS or cleaned in STYLE_NAME_FILLER_WORDS:
            continue
        tokens.add(cleaned)
    return tokens


def remove_duplicate_name_expansions(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        name_tokens = meaningful_name_tokens(name)
        if len(name_tokens) < 2:
            continue

        pattern = re.compile(rf"({re.escape(name)})(?P<tail>(?:\s+(?![.!?,;:\n])[A-Za-z&'-]+){{1,10}})", re.IGNORECASE)
        search_from = 0
        while True:
            match = pattern.search(restored, search_from)
            if not match:
                break

            tail = match.group("tail")
            tail_words = re.findall(r"\s+[A-Za-z&'-]+", tail)
            duplicate_words: list[str] = []
            for raw_word in tail_words:
                word = raw_word.strip()
                lowered = word.lower().strip("&'-")
                is_title_like = word[:1].isupper() or lowered in NAME_CONNECTOR_WORDS or lowered in STYLE_NAME_FILLER_WORDS or lowered in VENUE_WORDS
                if not is_title_like:
                    break
                duplicate_words.append(raw_word)

            duplicate_tail = "".join(duplicate_words)
            tail_tokens = meaningful_name_tokens(duplicate_tail)
            if not tail_tokens:
                search_from = match.end()
                continue

            overlap = len(name_tokens & tail_tokens)
            has_venue_token = bool(tail_tokens & VENUE_WORDS)
            has_style_filler = any(word in duplicate_tail.lower() for word in STYLE_NAME_FILLER_WORDS)
            is_probable_duplicate = overlap >= 1 and (has_venue_token or has_style_filler or overlap >= 2)
            if not is_probable_duplicate:
                search_from = match.end()
                continue

            duplicate_start = match.start("tail")
            duplicate_end = duplicate_start + len(duplicate_tail)
            restored = restored[:duplicate_start] + restored[duplicate_end:]
            search_from = match.start() + len(name)
    return re.sub(r"\s{2,}", " ", restored).strip()


def remove_parenthetical_name_expansions(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        name_tokens = meaningful_name_tokens(name)
        if len(name_tokens) < 2:
            continue

        pattern = re.compile(rf"({re.escape(name)})\s*\((?P<tail>[^)]{{1,80}})\)", re.IGNORECASE)
        search_from = 0
        while True:
            match = pattern.search(restored, search_from)
            if not match:
                break

            tail = match.group("tail")
            tail_tokens = meaningful_name_tokens(tail)
            has_matching_token = any(
                SequenceMatcher(None, tail_token, name_token).ratio() >= 0.78
                for tail_token in tail_tokens
                for name_token in name_tokens
            )
            has_place_connector = bool(re.search(r"\b(?:at|in|of|the)\b", tail, re.IGNORECASE))
            if not (has_matching_token and has_place_connector):
                search_from = match.end()
                continue

            restored = restored[: match.end(1)] + restored[match.end() :]
            search_from = match.start() + len(name)

    return re.sub(r"\s{2,}", " ", restored).strip()


def remove_duplicate_name_suffixes(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = name.split()
        if not words:
            continue

        suffixes = [words[-1]]
        if len(words) >= 2:
            suffixes.append(" ".join(words[-2:]))

        for suffix in sorted(suffixes, key=len, reverse=True):
            pattern = re.compile(rf"({re.escape(name)})\s+{re.escape(suffix)}\b", re.IGNORECASE)
            restored = pattern.sub(name, restored)
    return restored


def restore_protected_name_case(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        restored = re.sub(re.escape(name), name, restored, flags=re.IGNORECASE)
    return restored


def restore_protected_names(text: str, names: list[str]) -> str:
    restored = restore_protected_name_case(text, names)
    restored = restore_compacted_names(restored, names)
    restored = restore_venue_names(restored, names)
    restored = restore_shortened_names(restored, names)
    restored = remove_duplicate_name_expansions(restored, names)
    restored = remove_parenthetical_name_expansions(restored, names)
    return remove_duplicate_name_suffixes(restored, names)


def create_app(args: argparse.Namespace) -> FastAPI:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.adapter,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    app = FastAPI(title="Persona Style Transfer")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "adapter": args.adapter,
            "cuda": torch.cuda.is_available(),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }

    @app.post("/style-transfer", response_model=StyleTransferResponse)
    def style_transfer(request: StyleTransferRequest) -> StyleTransferResponse:
        protected_names = extract_protected_names(request.neutralText)
        protected_literals = extract_protected_literals(request.neutralText)
        preserve_verbatim = should_preserve_verbatim_content(request.userMessage, request.neutralText)
        verbatim_blocks = extract_verbatim_blocks(request.neutralText) if preserve_verbatim else []
        if preserve_verbatim and should_bypass_style_for_empty_verbatim_request(request.neutralText, verbatim_blocks):
            return StyleTransferResponse(
                styledText=request.neutralText,
                metadata={
                    "adapter": args.adapter,
                    "personaId": request.personaId,
                    "sourceProvider": request.sourceProvider,
                    "temperature": args.temperature,
                    "topP": args.top_p,
                    "repetitionPenalty": args.repetition_penalty,
                    "noRepeatNgramSize": args.no_repeat_ngram_size,
                    "protectedNameCount": len(protected_names),
                    "protectedLiteralCount": len(protected_literals),
                    "preserveVerbatim": preserve_verbatim,
                    "protectedVerbatimBlockCount": len(verbatim_blocks),
                    "styleBypassed": "empty_verbatim_refusal",
                },
            )
        messages = [
            {
                "role": "user",
                "content": (
                    "Rewrite the neutral answer in the target persona style.\n"
                    "Treat the neutral answer only as source content, not as a style example. "
                    "Do not imitate the neutral answer's voice, politeness level, or phrasing. "
                    "Use the target persona voice only.\n"
                    "Preserve every factual claim exactly. Keep all names, dates, years, numbers, "
                    "locations, durations, and order of events unchanged. Do not add new facts. "
                    "Preserve the gender, title, role, and type of every person, group, place, brand, "
                    "team, and object. Do not call men women, women men, teams people, places people, "
                    "or objects people unless the neutral answer does. "
                    "Do not make jokes that contradict the neutral answer. Do not imply uncertainty "
                    "when the neutral answer is certain. If the neutral answer is factual, keep the "
                    "facts intact and only change tone, rhythm, and attitude. Preserve the neutral "
                    "answer's structure when it is useful, including numbered lists, bullets, and "
                    "separate items. Do not rename people, venues, businesses, museums, parks, teams, "
                    "or landmarks. Do not insert profanity inside proper nouns or official names. "
                    "Do not replace listed places with other places. If the neutral answer contains "
                    "quoted text, scripture, speech excerpts, book passages, verse lines, poem lines, "
                    "lyrics, or text the user asked for exactly as-is, copy that content exactly and "
                    "only style the short setup around it. If the neutral answer says it could not "
                    "find, cannot verify, lacks exact wording, or does not have enough information, "
                    "keep that limitation exactly and do not answer from memory. "
                    "The styled answer must still answer the user question directly.\n\n"
                    "Example of the required behavior:\n"
                    "Neutral: 1. Klyde Warren Park is downtown and has food trucks.\n"
                    "Styled: 1. Klyde Warren Park\n"
                    "That place is downtown with food trucks and it gets lit.\n"
                    "Bad styled answer: Klyde Motherfucker Warren Park is downtown.\n\n"
                    f"{protected_names_prompt(protected_names)}"
                    f"{protected_literals_prompt(protected_literals)}"
                    f"{verbatim_blocks_prompt(verbatim_blocks)}"
                    f"User question:\n{request.userMessage or ''}\n\n"
                    f"Neutral answer:\n{request.neutralText}"
                ),
            }
        ]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(
            [prompt],
            return_tensors="pt",
            truncation=True,
            max_length=args.max_seq_length,
        ).to("cuda")
        dynamic_max_new_tokens = estimate_dynamic_max_new_tokens(tokenizer, request.neutralText, args.max_new_tokens)

        def generate_styled_text(max_new_tokens: int, *, strict_retry: bool = False) -> str:
            generation_kwargs: dict[str, Any] = {
                "max_new_tokens": max_new_tokens,
                "repetition_penalty": args.repetition_penalty,
                "no_repeat_ngram_size": args.no_repeat_ngram_size,
                "do_sample": not strict_retry,
                "pad_token_id": tokenizer.eos_token_id,
            }
            if strict_retry:
                generation_kwargs["top_p"] = 1.0
            else:
                generation_kwargs["temperature"] = args.temperature
                generation_kwargs["top_p"] = args.top_p

            outputs = model.generate(**inputs, **generation_kwargs)
            generated = outputs[0][inputs["input_ids"].shape[-1] :]
            return tokenizer.decode(generated, skip_special_tokens=True).strip()

        styled_text = generate_styled_text(dynamic_max_new_tokens)
        retried_for_length = False
        if is_runaway_output(styled_text, request.neutralText):
            retry_max_new_tokens = max(
                MIN_DYNAMIC_NEW_TOKENS,
                min(dynamic_max_new_tokens, int(dynamic_max_new_tokens * 0.65)),
            )
            retry_messages = [
                {
                    "role": "user",
                    "content": (
                        messages[0]["content"]
                        + "\n\nLength correction: keep the styled answer close to the neutral answer's "
                        "length. Do not list extra topics, capabilities, domains, examples, or services. "
                        "Do not continue after the direct answer is complete."
                    ),
                }
            ]
            retry_prompt = tokenizer.apply_chat_template(retry_messages, tokenize=False, add_generation_prompt=True)
            inputs = tokenizer(
                [retry_prompt],
                return_tensors="pt",
                truncation=True,
                max_length=args.max_seq_length,
            ).to("cuda")
            styled_text = generate_styled_text(retry_max_new_tokens, strict_retry=True)
            retried_for_length = True
        styled_text = restore_protected_names(styled_text, protected_names)
        styled_text = restore_protected_literals(styled_text, protected_literals)
        if preserve_verbatim:
            styled_text = restore_verbatim_blocks(styled_text, request.neutralText, verbatim_blocks)
        if should_conservatively_style_uncertain_answer(request.neutralText) and not verbatim_blocks:
            styled_text = conservative_uncertainty_style(request.neutralText)
        return StyleTransferResponse(
            styledText=styled_text,
            metadata={
                "adapter": args.adapter,
                "personaId": request.personaId,
                "sourceProvider": request.sourceProvider,
                "temperature": args.temperature,
                "topP": args.top_p,
                "repetitionPenalty": args.repetition_penalty,
                "noRepeatNgramSize": args.no_repeat_ngram_size,
                "configuredMaxNewTokens": args.max_new_tokens,
                "dynamicMaxNewTokens": dynamic_max_new_tokens,
                "retriedForLength": retried_for_length,
                "protectedNameCount": len(protected_names),
                "protectedLiteralCount": len(protected_literals),
                "preserveVerbatim": preserve_verbatim,
                "protectedVerbatimBlockCount": len(verbatim_blocks),
                "conservativeUncertaintyStyle": should_conservatively_style_uncertain_answer(request.neutralText)
                and not verbatim_blocks,
            },
        )

    return app


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(args), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
