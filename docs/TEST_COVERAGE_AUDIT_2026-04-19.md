# Test Coverage Audit — v3.22 → v3.33 (2026-04-19)

Pre–v3.34 audit of the coverage shipped alongside the last dozen user-facing
commits. Consolidates Claude's file-walk of `apps/electron/test/`,
`apps/renderer/src/*.test.ts`, and `apps/e2e/src/` with a parallel Codex
`codex exec` audit of the same commit range.

## Scope

| Version | SHA      | Change                                                                 |
|---------|----------|------------------------------------------------------------------------|
| v3.22   | b541966  | restore-toggle overlay remount + global-ref fallback                   |
| v3.23   | f07970c  | polish batch (normalization, reference indicators, cmd-r, badge clip)  |
| v3.24   | c1a3e28  | floating version switcher + checklist now-playing highlight            |
| v3.25   | eb55aca  | agent-chat drag-to-move/resize + localStorage persist                  |
| v3.26   | 140fc02  | promote mastering findings to checklist items                          |
| v3.27   | af9a5bb  | skeleton loaders on Mastering Checklist                                |
| v3.28   | f97cce5  | Mastering Checklist expansion — 13 rules + rule module                 |
| v3.29   | 6ed2420  | state split migration (HIGH-RISK for user data)                        |
| v3.30   | 05f66ff  | AI rec schema + IPC                                                    |
| v3.31   | 8c98648  | AI rec UI toggle + Regenerate + captions                               |
| v3.32   | ab0d687  | Spectrum AI rec unification + legacy migration (HIGH-RISK)             |
| v3.33   | 38ec1bb  | auto-run + agent tool                                                  |

## Current test infra

- `apps/electron/test/*.test.cjs` — Node built-in test runner, 27 tests passing.
  Run via `npm test -w @producer-player/electron`.
- `apps/renderer/src/*.test.ts` — vitest, 159 tests across 11 files, all
  passing. **No `test` script in `apps/renderer/package.json`** — must be run
  manually via `npx vitest run`. CI does NOT run these. Gap A.
- `apps/e2e/src/*.spec.ts` — Playwright Electron, ~45 specs. Smoke subset via
  `npm run -w @producer-player/e2e test:smoke` (`@smoke` tag); CI runs
  `ci:smoke` on ubuntu + windows.
- `packages/domain` — Node built-in test runner. Runs on Windows CI only
  (gap: not on ubuntu).

## CI gap summary

- **renderer vitest tests never run in CI** (no `test` script wired). This is
  the single biggest coverage gap: 159 tests only run when a developer
  remembers to invoke vitest manually.
- **electron unit tests never run in CI**. Ubuntu CI runs `e2e:smoke` but
  skips `npm test -w @producer-player/electron`, so the 27 state-service
  unit tests (including the HIGH-RISK migration + AI-rec round-trips) are
  unprotected on every push.
- Windows CI runs only `packages/domain` tests, not electron or renderer.

## Per-commit coverage

### v3.22 b541966 — restore-toggle + global-ref fallback
- **Unit:** `referenceLevelMatchGain.test.ts` (179 lines) exercises reference
  gain maths but NOT the restore-toggle hydration logic.
- **E2E:** `checklist-reference-restore-toggle.spec.ts` (217L),
  `checklist-reference-restore-toggle-fullscreen.spec.ts` (210L),
  `reference-global-fallback.spec.ts` (329L). Full coverage of the two fixes.
- **Gap:** a direct test for the "fullscreen overlay remount re-reads
  localStorage" bug (analysisExpanded flip) is implicit in the fullscreen
  spec but could be made explicit.

### v3.23 f07970c — polish batch
- **E2E:** `v3-23-polish.spec.ts` (234L), `loudness-integrated-emphasis.spec.ts`
  (233L). Covers platform-norm readouts, reference indicators, listening
  device, cmd-r, badge clipping.
- **Gap:** none material.

### v3.24 c1a3e28 — floating version switcher + now-playing highlight
- **E2E:** `version-switcher-and-now-playing.spec.ts` (302L) and
  `quick-switcher-checklist.spec.ts` (159L).
- **Gap:** no unit test for the "hide trigger when song has <2 versions"
  logic. Covered by E2E.

### v3.25 eb55aca — agent-chat drag + resize
- **E2E:** `agent-chat-drag-resize.spec.ts` (334L),
  `agent-chat-panel.spec.ts` (1159L).
- **Gap:** no unit test for the viewport-clamp math
  (`clampBoundsToViewport`). Stale-monitor-bounds scenarios and 8-handle
  resize are covered by the drag-resize spec.

### v3.26 140fc02 — promote mastering → checklist
- **Unit:** `masteringChecklistRules.test.ts` (488L) exercises rule →
  checklist text construction.
- **E2E:** `mastering-to-checklist.spec.ts` (314L).
- **Gap:** none material.

### v3.27 af9a5bb — skeleton loaders
- **E2E:** `mastering-panels-no-layout-shift.spec.ts` (246L).
- **Gap:** none material — layout-shift is the relevant user concern.

### v3.28 f97cce5 — Mastering Checklist expansion (+13 rules)
- **Unit:** `masteringChecklistRules.test.ts` (488L) covers the rule module.
  Rule-by-rule pass/warn/fail/unavailable table explicitly in tests.
- **Gap:** verify all 13 new rules have unit coverage including the
  `unavailable` branch; tiered-clipping threshold tests (0 / 1-3 / ≥4); LUFS
  upper-bound tightening to -8.

### v3.29 6ed2420 — state split migration (HIGH-RISK)
- **Unit:** `state-service-migration.test.cjs` (335L, 6 tests):
  PER_TRACK_KEYS surface, splitStateForDisk, fresh install, populated
  monolithic migration with backup, idempotence, write-path pruning.
- **Gap (P0 for user data):**
  - No test for a **corrupt per-track file** (partial JSON).
  - No test for **half-migrated recovery** (sentinel missing but split dir
    exists; or split dir missing but sentinel present).
  - No test for **monolithic-only fallback when sentinel absent** (Phase 1.5
    safety net described in commit body).
  - No test that the pre-split `*.bak-pre-split-<ts>` backup is **restorable**
    (shape round-trip).
  - No test for disk full / write-failure during migration (partial write
    leaves monolithic intact).

### v3.30 05f66ff — AI rec schema + IPC
- **Unit:** `state-service-ai-recommendations.test.cjs` (508L, 12 tests) —
  set/get/clear/markStale round-trips, concurrent-write regression tests,
  malformed-entry parseUserState drop, unicode song/metric IDs.
- **Gap:** no explicit round-trip of AI recs through `exportUserState` /
  `importUserState` — matters because the split layout means AI recs now live
  in per-track files.

### v3.31 8c98648 — AI rec UI toggle + Regenerate + captions
- **E2E:** `ai-recommendations-ui.spec.ts` (273L) — fullscreen toggle,
  regenerate, stale strikethrough rendering.
- **Gap:** no test for a **caption render with truncated reason text**; no
  test that the "Regenerate" button is disabled during an in-flight run.

### v3.32 ab0d687 — Spectrum AI rec unification (HIGH-RISK migration)
- **Unit:** `state-service-spectrum-migration.test.cjs` (318L, 4 tests):
  legacy `aiEqRecommendations` → unified store, stale→fresh overwrite,
  unified-store probe regression, regenerate clear.
- **E2E:** `spectrum-ai-rec-unified.spec.ts` (233L) — dual-write round-trip.
- **Gap:** no test for the **one-shot sentinel gate**
  (`SPECTRUM_AI_MIGRATED_TO_UNIFIED_KEY`) — does a second launch re-migrate
  and stale-clobber fresh recs? Commit body explicitly calls this a Codex
  P2 concern — the unified-store probe exists but no test proves the
  *combined* sentinel+probe path is idempotent across restart.
- **Gap:** no corrupt-`aiEqRecommendations` test (malformed legacy map).

### v3.33 38ec1bb — auto-run + agent tool
- **Unit:** `state-service-ai-recommendations-autorun.test.cjs` (252L, 5
  tests) — `aiRecommendedFlag` transitions, stale detection,
  `agentAutoRecommendEnabled` round-trip.
- **E2E:** `ai-recommendations-full-pipeline.spec.ts` (413L) — mocks the
  agent via `__producerPlayerAiRecMock`, verifies load-track → auto-run →
  caption-render. `agent-streaming.spec.ts`, `agent-chat-panel.spec.ts`.
- **Gap:** no test for the **90s hard-timeout** branch of
  `triggerMasteringRecommendationsAgentRun`; no test for the
  **monotonic run-id guard** (concurrent auto-run races); no test for the
  agent-chat tool pattern-match (`"rerun mastering recommendations"`,
  `/regenerate`) actually invoking the handler.

## Gap tier breakdown

### MUST-ADD (safety net for recently-shipped HIGH-RISK work)

1. **state-split corrupt-file recovery** — seed a split layout with a
   truncated per-track JSON and confirm the service surfaces an empty
   per-track slot rather than crashing; monolithic fallback still serves
   the other tracks.
2. **state-split half-migrated recovery** — sentinel present but tracks dir
   missing → re-run migration from monolithic without data loss; tracks dir
   present but sentinel missing → idempotent re-split (no clobber).
3. **state-split backup restorability** — write a monolithic, migrate,
   confirm the `.bak-pre-split-<ts>` file is a valid JSON round-trip of the
   pre-migration state.
4. **Spectrum legacy migration idempotence across restart** — simulate the
   renderer sentinel gate by flipping between "migrated" and
   "not-migrated" modes and confirming the unified-store probe stops a
   second migration from clobbering fresh recs written post-v3.32.
5. **Export/import round-trip with AI recs in split layout** — export
   after seeding AI recs, nuke the state dir, import, confirm full
   fidelity including per-track AI recs.
6. **parseUserState drops corrupt `aiEqRecommendations` legacy entries** —
   malformed legacy map doesn't block migration or crash parseUserState.
7. **Electron unit tests in CI** — wire `npm test -w @producer-player/electron`
   into `.github/workflows/ci.yml` on ubuntu.
8. **Renderer vitest in CI** — add a `test` script to
   `apps/renderer/package.json` and wire it into CI.
9. **Post-push CI monitoring rule** — add to AGENTS.md.
10. **state-service monolithic-only fallback** — sentinel absent (pre-v3.29
    user) still reads/writes the monolithic file cleanly; confirm no
    silent data drop.

### SHOULD-ADD

11. **agent-chat drag bounds clamp on viewport shrink** — viewport shrinks
    below stored bounds → panel snaps into frame without being lost.
12. **AI rec 90s timeout path** — renderer helper rejects cleanly when the
    mock agent never completes.
13. **Monotonic run-id guard** — two concurrent auto-runs → only the newest
    populates state, older's writes are ignored.
14. **Regenerate button disabled during in-flight run**.
15. **Mastering rule `unavailable` branch for every new v3.28 rule** —
    explicit table assertion.

### NICE-TO-ADD

16. AI rec caption render with truncated reason text.
17. Version-switcher hide/show logic unit test.
18. Agent-chat tool pattern-match renderer handler (covers the "rerun
    mastering recommendations" phrase → handler invocation path).
19. Disk-full / write-failure during migration (mock fs.writeFileSync
    throw).

## Codex parallel audit

Codex `gpt-5-codex` run against the same commit list (1 round, tagged the
same MUST/SHOULD/NICE tiers). Headline overlaps with Claude's list above;
novel items Codex flagged that Claude missed:

- **`agentPrompts.ts` parser/prompt/fingerprint unit tests** — no coverage
  for `parseMasteringRecommendationsResponse` (fenced JSON, bare JSON,
  prose before/after, invalid JSON → null, empty `recommendedValue`
  dropped, non-finite raw values dropped),
  `buildMasteringRecommendationsPrompt`, or
  `computeMasteringAnalysisVersion` (deterministic ordering, rounding,
  null/NaN normalization, tonal-balance → fingerprint-change). MUST-ADD.
- **Silent auto-run dispatch vs visible chat** — no test that auto-run
  drops when visible chat is streaming, and that auto-run state/dedupe
  key is released so the next gate succeeds. MUST-ADD.
- **AI agent failure handling** — mock returns invalid JSON → UI exits
  generating state, prior recs untouched, Regenerate remains enabled.
  Mock throws → no stranded loading caption. MUST-ADD.
- **`buildMasteringChecklistItemText` per-rule coverage for every v3.28
  rule** — pass/warn/fail/unavailable + null inputs → null.
  SHOULD-ADD.
- **Partial legacy Spectrum arrays / non-number gains / extra bands**
  preserving non-spectrum recs. SHOULD-ADD.

Codex's highest-priority recommendation matches Claude's: state split
migration + AI rec pipeline are where user-data / agent-call waste bugs
live. Codex used 119,846 tokens in the single round.

## Action plan — v3.34

Phase B of the audit task implements items 1–10 from MUST-ADD. Each gap
lands as a dedicated commit so progress is banked incrementally.
