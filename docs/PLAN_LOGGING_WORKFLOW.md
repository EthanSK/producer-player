# PLAN logging workflow (chat → PLAN.md)

This project treats `PLAN.md` as the canonical verbatim record of Ethan's Producer Player requests.

## Why this exists

Root cause observed in chat audits: updates were often written as implementation summaries after sub-agent runs, and some user prompts/feedback (especially short follow-ups) were not copied into `PLAN.md` verbatim.

## New guardrail

Use the transcript audit script before finalizing Producer Player work:

```bash
python3 scripts/plan_verbatim_audit.py \
  --session /path/to/openclaw-session.jsonl \
  --plan PLAN.md
```

If anything is missing, backfill automatically:

```bash
python3 scripts/plan_verbatim_audit.py \
  --session /path/to/openclaw-session.jsonl \
  --plan PLAN.md \
  --append-missing
```

Re-run the audit until it reports:

- `Missing verbatim prompts in PLAN: 0`

## Required discipline

1. Log Ethan prompts **verbatim** (not paraphrased) with timestamp (and message id where available).
2. Run the audit before completion handoff/commit.
3. Do not mark the task complete while audit output is non-zero.

This keeps PLAN coverage reliable even when work is split across many sub-agents.
