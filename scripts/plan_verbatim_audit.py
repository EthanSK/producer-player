#!/usr/bin/env python3
"""Audit PLAN.md for verbatim project prompts from an OpenClaw session JSONL.

Usage:
  python3 scripts/plan_verbatim_audit.py \
    --session /path/to/session.jsonl \
    --plan /path/to/PLAN.md

Optional:
  --append-missing  Append missing prompts to PLAN.md in a structured section.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List


NON_USER_MARKERS = (
    "OpenClaw runtime context (internal)",
    "A scheduled reminder has been triggered.",
    "Pre-compaction memory flush.",
    "System:",
)

PROJECT_ANCHOR_KEYWORDS = (
    "producer player",
    "playback",
)

UNRELATED_CONTEXT_HINTS = (
    "high philosophy",
    "notion",
    "business ideas",
    "ai slop machine",
    "todo board",
)


@dataclass
class Prompt:
    message_id: str
    timestamp: str
    text: str


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_user_text(raw: str) -> str:
    if "User text:" in raw:
        body = raw.split("User text:", 1)[1].strip()
        if "Transcript:" in body:
            body = body.split("Transcript:", 1)[1].strip()
        return body.strip()

    # Plain text messages may still include metadata wrappers.
    body = re.sub(
        r"Conversation info \(untrusted metadata\):\s*```json.*?```",
        "",
        raw,
        flags=re.DOTALL,
    )
    body = re.sub(
        r"Sender \(untrusted metadata\):\s*```json.*?```",
        "",
        body,
        flags=re.DOTALL,
    )
    return body.strip()


def extract_metadata(raw: str) -> tuple[str | None, str | None]:
    message_id_match = re.search(r'"message_id"\s*:\s*"([^"]+)"', raw)
    timestamp_match = re.search(r'"timestamp"\s*:\s*"([^"]+)"', raw)
    return (
        message_id_match.group(1) if message_id_match else None,
        timestamp_match.group(1) if timestamp_match else None,
    )


def should_include(text: str, in_project_thread: bool) -> bool:
    low = text.lower()
    if any(marker in text for marker in NON_USER_MARKERS):
        return False

    if not in_project_thread:
        return any(keyword in low for keyword in PROJECT_ANCHOR_KEYWORDS)

    # Once in project thread, keep everything unless we clearly drifted to unrelated topics.
    if any(hint in low for hint in UNRELATED_CONTEXT_HINTS):
        return False

    return True


def iter_prompts(session_path: Path) -> Iterable[Prompt]:
    in_project_thread = False

    with session_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            obj = json.loads(line)
            if obj.get("type") != "message":
                continue
            msg = obj.get("message", {})
            if msg.get("role") != "user":
                continue

            content = msg.get("content")
            if isinstance(content, list):
                raw = "".join(part.get("text", "") for part in content if part.get("type") == "text")
            else:
                raw = str(content or "")

            if not raw:
                continue

            parsed = parse_user_text(raw)
            message_id, timestamp = extract_metadata(raw)
            if not message_id:
                continue

            include = should_include(parsed, in_project_thread)
            if include:
                low = parsed.lower()
                if not in_project_thread and any(k in low for k in PROJECT_ANCHOR_KEYWORDS):
                    in_project_thread = True

                yield Prompt(
                    message_id=message_id,
                    timestamp=timestamp or "(timestamp unavailable)",
                    text=parsed,
                )


def build_append_block(missing: List[Prompt], session_path: Path) -> str:
    lines = []
    lines.append("\n\n---\n")
    lines.append("\n## Chat-to-PLAN audit backfill (session transcript reconciliation)\n")
    lines.append("\nRecovered from transcript:\n")
    lines.append(f"`{session_path}`\n")
    lines.append("\n### Missing Ethan prompts backfilled verbatim\n")

    for prompt in missing:
        lines.append(f"\n#### Ethan message (verbatim) — message_id {prompt.message_id}\n")
        lines.append(f"\n**Timestamp:** {prompt.timestamp}\n")
        lines.append("\n```text\n")
        lines.append(prompt.text.rstrip() + "\n")
        lines.append("```\n")

    return "".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit PLAN.md for missing verbatim Producer Player prompts.")
    parser.add_argument("--session", required=True, help="Path to OpenClaw session JSONL transcript.")
    parser.add_argument("--plan", required=True, help="Path to PLAN.md.")
    parser.add_argument(
        "--append-missing",
        action="store_true",
        help="Append missing prompts directly to PLAN.md.",
    )

    args = parser.parse_args()
    session_path = Path(args.session)
    plan_path = Path(args.plan)

    plan_text = plan_path.read_text(encoding="utf-8")
    normalized_plan = normalize(plan_text)

    prompts = list(iter_prompts(session_path))

    seen_ids = set()
    unique_prompts: List[Prompt] = []
    for prompt in prompts:
        if prompt.message_id in seen_ids:
            continue
        seen_ids.add(prompt.message_id)
        unique_prompts.append(prompt)

    missing = [p for p in unique_prompts if normalize(p.text) not in normalized_plan]

    print(f"Detected project-relevant prompts: {len(unique_prompts)}")
    print(f"Missing verbatim prompts in PLAN: {len(missing)}")
    for p in missing:
        snippet = normalize(p.text)
        if len(snippet) > 140:
            snippet = snippet[:140] + "..."
        print(f"- {p.message_id} | {p.timestamp} | {snippet}")

    if args.append_missing and missing:
        append_block = build_append_block(missing, session_path)
        plan_path.write_text(plan_text.rstrip() + append_block + "\n", encoding="utf-8")
        print(f"Appended {len(missing)} missing prompt(s) to {plan_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
