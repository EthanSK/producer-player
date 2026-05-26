# Queue Priority Report - 2026-05-26

## Scope

This report reviews the recent Producer Player analysis-queue fixes and Ethan's voice-note intent for priority ordering:

- Main-track rows should load their information before lower-value work.
- Version history for the currently selected track is useful, but lower priority than the main tracks.
- Higher-priority work must be able to interrupt lower-priority work instead of waiting behind it.
- The queue must be tested with real tracks, rapid selections, and full drain behavior.

## Evidence Reviewed

- memory/2026-05-24.md records the prior "2 active / 70 queued" bug and the failed loop of warmup/priority fixes.
- Git history shows the queue evolved through v3.128 visible LUFS warmup, v3.141-v3.144 measured/preview cache decoupling, v3.166 new-version warmup priority, v3.190 rapid-switch demotion, v3.195-v3.219 preemption fixes, v3.201 inflight dedupe across requeue, and v3.237-v3.263 delayed/reserved selected analysis.
- The 2026-05-25/26 voice-note burst added the explicit ordering requirement: main tracks first, selected-track version history after that, and a real interrupt priority system.

## Intended Priority Ladder

1. USER_SELECTED / foreground playback analysis
   - Triggered by selecting, cueing, or playing a track/version.
   - Must reserve the queue immediately, even if execution waits briefly to avoid playback-start CPU spikes.
   - Can interrupt/demote any lower-priority warmup.

2. Main visible track-row information
   - Measured LUFS and row-level information for the main track list.
   - This is the first thing Ethan scans when opening the app, so it should outrank version-history warmup.
   - Should drain across visible/main tracks before background version-history work expands.

3. Selected-track version-history information
   - Useful for the inspector, but Ethan explicitly said it is "not even that important" compared with main-track rows.
   - Should run only after the selected foreground track is ready and main visible rows have started or drained.

4. Nearby/recent/library warmup
   - Helpful for perceived speed, but never allowed to block a user-selected job.
   - Should be preemptible and resumable.

5. Hidden/background library expansion
   - Lowest priority.
   - Should fill caches opportunistically only when no foreground/main-row work is waiting.

## Implementation Mapping

- The current queue uses explicit priority levels and cancellation/restart behavior so selected user work can replace lower-priority duplicates instead of inheriting stale timeouts.
- Main-track warmup is treated as higher value than selected version-history warmup.
- Version-history measured analysis is deliberately lower priority.
- E2E coverage now includes interrupt behavior, real track creation, startup warmup, rapid play selections, and full queue drain.

## Remaining Watchpoints

- Do not reintroduce timer-only delays that postpone enqueue/reservation; delays belong inside an already-reserved queue slot.
- Do not dedupe a new high-priority selected request into an old low-priority warmup promise if the old promise is near timeout.
- Keep the visible row loading state tied to the work users actually care about: main list first, version-history later.
- If future CPU-smoothing is needed, prefer queue-level start delays and priority-aware preemption over ad hoc setTimeout scheduling outside the queue.
