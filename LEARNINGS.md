# Learnings

Per-repo institutional memory for fixes. Every entry below is a real bug we hit + how we solved it. Check this file BEFORE attempting a same-looking fix.

Maintained by the `learnings` skill — see `~/.claude/skills/learnings/skill.md`.

## Format

Each entry looks like:

```
---
**Date:** YYYY-MM-DDTHH:MM:SSZ
**Trigger:** <voice N / message snippet / null>
**Symptom:** <what was visible>
**Root cause:** <what we actually found>
**Fix:** <file:line + short prose + commit SHA>
**Guard:** <test / lint / watchdog / comment that prevents regression — or 'none'>
---
```

## Entries

(newest first)

---
**Date:** 2026-05-29T20:42:10Z
**Trigger:** Ethan voice 7199 (2026-05-29): floating selection → Add to chat feature
**Symptom:** Adding a portalled selection tooltip into a panel with overflow:auto needed a forwardRef handle on the existing composer
**Root cause:** AgentComposer owned its own text state; lifting all text up would touch mic/auto-resize/send paths
**Fix:** Convert AgentComposer to forwardRef<AgentComposerHandle, Props> + useImperativeHandle exposing only appendQuotedSelection(text). Parent calls handle.appendQuotedSelection on tooltip click. Pure-logic helpers (trim, blockquote, position math) live in agentChatSelection.ts with 27 vitest unit tests.
**Commit:** 97c2365
**Guard:** agentChatSelection.test.ts pins the helpers (truncate cap, blockquote format, append-no-overwrite, tooltip position math incl. viewport-edge + container clamp)
---

