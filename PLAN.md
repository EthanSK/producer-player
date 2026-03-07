# Producer Player — PLAN (canonical project log)

## Project

- Name: **Producer Player**
- Path: `/Users/ethansk/Projects/producer-player`
- Goal: Build a serious Swift/SwiftUI/AVFoundation/SQLite MVP for producer re-render workflows.

---

## Verbatim log: Ethan messages + assistant replies (project-relevant)

### Ethan message (text context + prompt + linked-directory addition)

**Timestamp:** Fri 2026-03-06 23:50 GMT

```text
also in the prompt say it should be able to be linked to a directory, and will automatically track it and update new changes and remove old changes. there should even be a toggle to automatically move old songs to a folder, by default an old folder in the same dir as ur songs. if u drag songs from a new dir it should start a new 'session' which shows in the sidebar. or 'album' actually better name
```

**Also included in the same message context (verbatim prompt body):**

```text
Build a macOS application called Producer Player designed specifically for music producers who frequently export new versions of the same track from DAWs (Ableton, Logic, etc.).

Goal:
Create a music player where re-exported versions of the same song automatically replace or group with the previous version so producers can instantly audition new renders without manually fixing metadata or tags.

Key concept:
The app should treat tracks as logical songs rather than individual files. When a new file appears with a similar name, the app should match it to the existing song entry and update or attach it.

Core behaviour:
1. Library (watch folders; watches new/changed files; wav/aiff/flac/mp3/m4a)
2. Song identity matching (exact filename ignoring extension, fuzzy, regex, fallback new song)
3. Fuzzy matching (Levenshtein-style, version token tolerance, adjustable threshold)
4. Regex matching rules
5. Version handling per logical song; latest active by default
6. Producer workflow features (gapless playback, instant reload, keyboard shortcuts, drag/drop, re-render notification)
7. UI (left watch folders + songs, main list, right panel version history + waveform, quick fuzzy search, toggle songs vs versions)
8. Performance (background indexing, incremental scanning, SQLite)
9. Platform stack (Swift, SwiftUI, AVFoundation)
10. Best effort behavior (ask user when uncertain and train matcher)
```

---

### Assistant reply (project-relevant)

**Timestamp:** Fri 2026-03-06 23:52 GMT

```text
Add this block to your prompt:

**12. Linked directories + album sessions**
- Users can link a folder and the app continuously watches it for new, changed, and deleted files.
- If a source file is deleted or replaced, the library updates automatically (no stale entries).
- Add a toggle: **Auto-move old versions** (default ON).
- Default archive path: an `old/` folder inside the same linked song directory (user can change this path).
- If the user drags tracks from a different directory, start a new sidebar group called an **Album**.
- Each Album has its own watch path, song list, and version history.
```

---

### Ethan voice note transcript

**Timestamp:** Fri 2026-03-06 23:53 GMT (Audio)

```text
By the way, is the default model GPT 5.3? Also, can you, you know, sub agent extra high thinking, do the whole project that I gave you? I split it over multiple messages. Also, there's a voice note related to it. Think you might need to retranscribe if you missed it. Also, one more thing, can you change the default thinking to high? And for sub agents, always use extra high. I had a rule for that. Yeah.
```

---

### Assistant replies (project kickoff)

**Timestamp:** Fri 2026-03-06 23:56 GMT

```text
Started: I’m applying your model/thinking settings now and launching a sub-agent (xhigh) to build the full Producer Player project from your split messages + voice-note context.
```

```text
Sub-agent is now running the full Producer Player build with xhigh thinking.
- label: producer-player-build
- run id: 776b8e9e-a28e-438b-a5e4-4a78ac3a7f73
```

```text
I included the project details from your split messages in the task.
If there’s a specific missed voice note you want re-transcribed, forward that exact one and I’ll re-run transcription on it explicitly.
```

---

## Current implementation plan executed in this run

1. Create Swift package app scaffold and initialize git repo.
2. Implement SQLite schema + repository for albums/songs/versions/indexing/matcher feedback.
3. Implement matcher (exact -> regex -> fuzzy -> fallback) with uncertain state.
4. Implement file scanner + folder watcher + stale cleanup + auto archive.
5. Implement SwiftUI tri-pane UI with:
   - left sidebar: watch folders + songs
   - main list: songs/versions, search, toggle
   - right panel: version history + waveform + matcher settings
6. Implement playback + keyboard command menu.
7. Write documentation and this canonical plan log.

---

## Voice-note reconciliation status

### What was found
- Found and incorporated the project-related voice-note transcript at **Fri 2026-03-06 23:53 GMT** (above verbatim).

### Gap / ambiguity
- Ethan referenced “there’s a voice note related to it” that might need retranscription.
- In accessible session history for this run, only the above project voice-note transcript was clearly present.

### Needed follow-up question
- **Can you forward or identify the exact additional voice note (message ID/time) that should be retranscribed for Producer Player?**

---

## Build verification

- `swift build` succeeded in `/Users/ethansk/Projects/producer-player`.

---

## Cross-platform Electron + TypeScript workstream (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sat 2026-03-07 00:43 GMT

```text
Oh, there's no built in or end to end or Open skill? We should make one. We should make the CLI of this into one. Can Open Claw skills just be CLI tools? Instructions to install if it doesn't exist and use it, put it into the path. Mac and ideally Windows, but I don't have Windows to test it on, so we can only test it on Mac for now. Also, have you checked the UI works and everything? Also okay. Look. I haven't checked the project yet, but you did it in Swift. I want it to be cross platform with Electron, with TypeScript. Look at the existing Okay. Keep the Swift MVP there. I'll test it later. But I have an existing project somewhere in my home folder, my projects folder, on the computer. Look at it for Electron advice and guidance and also AI music video studio for like rough guidance on how to set up the mono repo and style guides and types, etcetera. So, yeah, do a sub agent for that. Obviously, because it's a long running app, you should automatically be doing sub agents for this. I already told you in the past to do that.
```

### Priority add-on (verbatim)

**Timestamp:** Sat 2026-03-07 00:52 GMT

```text
That is the CLI that is. And, also, make end to end tests running and all that. Also, how was the status of the other agents?
```

### Assistant response summary (this run)

- Added Electron + TypeScript app scaffold (main/preload + renderer + contracts + domain + e2e)
- Kept Swift MVP source tree intact (no deletions)
- Added first runnable vertical slice for folder link/watch and logical song grouping
- Added Playwright Electron E2E happy path and CI-friendly command
- Wrote migration and E2E docs with current pass status
