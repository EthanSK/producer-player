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

---

## Public prebuilt release readiness (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sat 2026-03-07 21:11 GMT

```text
Yeah. In a sub agent, do all that.
```

**Task context in same run (verbatim):**

```text
He wants true downloadable prebuilt releases so users can download app directly (not build locally), using GitHub Actions.
```

### Assistant response summary (this run)

- Upgraded release workflow from scaffold to real macOS prebuilt artifact pipeline.
- Configured CI release workflow to build unsigned macOS ZIP artifacts on main/tag/manual runs.
- Added SHA-256 checksum generation and release asset attachment on `v*` tags.
- Updated README + landing page + public status docs to state exactly what can be downloaded now and where.
- Added/updated release documentation + template/changelog process (`docs/RELEASING.md`, `.github/RELEASE_NOTES_TEMPLATE.md`, `CHANGELOG.md`).
- Kept unrelated existing local E2E working-tree changes untouched.

---

## UX/player refactor feedback implementation (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sat 2026-03-07 22:29 GMT

```text
Okay. I'm reviewing producer player, and I've got some feedback. So firstly, it's not a music player. Why can't I play the songs? It should play them properly. Now any modifications to the file, I need to be able to I'm actually adding all this to plan.md on what I'm saying. Yeah. So we've got logical songs. And then secondly, there's some issues with how it figures out. I I have a song called Leaky and then a song called Leaky five. What I wanted for the fuzzy search is actually for it to be fuzzy matching. Also, the whole point is for me to be able to drag and drop each item in the playlist, in the logical songs view, but I can't. The whole point is I have wanna have an order that's maintained. Also, can you verify that the path I choose is saved between sessions? Also, logical songs should be called actual songs. That's better u I u x. Make sure to call it that. But yeah. And for the detecting whether a song is a song, want to use the fuzzy fuzzy matching for that. That's what I meant by fuzzy because, like, I see songs like Leaky and Leaky five, and I might have made a small mistake. But I swear wait. What did I say originally about how to do that? I think I came up with a better plan. Anyway, want you to figure out the best way of, like, maybe overcoming some typos. Actually no. You know what? Fuck that. No. Ignore that whole typos thing. I should fix the typos. Also, there should be a button to open the folder that we were currently watching in Finder. Maybe next to library or something. I don't know. Somewhere good. Do good UI for that. Yeah. So it has to make sure it matches with the v thing, leaky v. So ignore that thing about the fuzzy matching. Also, I don't think the placeholder should be quick fuzzy search. Just why is it called quick fuzzy search? Maybe you misinterpreted my what I wanted. And, actually, what I want is a button in the app as well to oh, that's on by default, a checkbox. I swear I mentioned this in the original plan to, automatically move the old versions of the files to an old folder in the watching directory. Make sure everything I'm saying is implemented. Actually, you know what? Maybe that could be like an organized button. Click it organized. Also, all of these things should have tool tips. Every single button should have a tool to explaining what it's doing and how it works. Also, rescan button is a button, but it looks the exact same as logical songs and versions. I feel like if these buttons do different things, they should be doing different they should look a bit different. Oh, am I not using this currently? Rescan versions. Versions in logical songs are kinda similar, they can be the same. Yeah. We read all of this shit implemented, man. We should drag drag and drop the songs. What else? The v one v two detection currently forces you to have a space at the end before it, but it should actually allow for no space. Just check the very end for v and then the number. Yeah. You might need to spawn a sub agent for this in a long running long, long running task. These are big, big refactors.
```

### Assistant implementation summary (this run)

- Added real playback transport in the Electron renderer (play/pause/stop/seek) for selected versions.
- Renamed all user-facing "Logical Songs" labels to "Actual Songs".
- Added drag-and-drop ordering in Actual Songs list and persisted order across sessions.
- Extended persisted app state to store linked folder paths, auto-organize setting, and song order.
- Added explicit watched-folder Finder open actions.
- Added "Organize" action and default-on auto-organize setting for moving older versions to `old/`.
- Added tooltips (`title`) to actionable controls.
- Restyled controls so rescan/organize actions are visually distinct from Actual Songs/Versions toggles.
- Updated song normalization to use suffix-based `v<number>` grouping at end-of-name, with or without spacing (e.g. `Leakyv5`, `Leaky v5`).
- Confirmed typo/fuzzy grouping was not added (final user intent preserved).
- Added/updated E2E coverage for no-space `v<number>` grouping, watch update behavior, folder-path persistence, and persisted song order across restart.

---

## Naming-convention guidance copy follow-up (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sat 2026-03-07 22:37 GMT

```text
Also, I want, I want you to have instructions under what is under the file file picker folder picker to to explain how the naming convention expects should be a v at the end. V one, v two, v three. This is an opinionated fucking app for the greats are good. For the great are good.
```

### Assistant implementation summary (this run)

- Added a prominent instructional guidance panel directly under folder path picker controls in the left sidebar.
- Guidance explicitly states required version suffix pattern at end-of-filename: `v1`, `v2`, `v3`, including both spaced and non-spaced forms (`Leaky v2`, `Leakyv2`).
- Kept tone opinionated/pro-producer while staying clean and professional.
- Added tooltip/help text reinforcement on the folder picker control and dedicated guidance help indicator.
- Added E2E assertion to verify the naming guidance is visible in UI.

---

## Release desktop mac script wiring fix + monitoring (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sat 2026-03-07 23:35 GMT

```text
Well, I want you to spend a long running sub agent fixing the release desktop Mac Mac script wiring. Fix it locally, see if it works, and then you can push it. Inspect the logs every few minutes. Check back on it for a few minutes for, like, half an hour until it's done.
```

### Assistant implementation summary (this run)

- Diagnosed workflow failure as missing `release:desktop:mac` script in root `package.json` while workflow still invokes it.
- Rewired root packaging config by restoring:
  - `release:desktop:mac` script
  - root `main` entry for packaged app
  - `build` block for electron-builder artifact naming/output
  - `electron-builder` dev dependency
- Validated locally with `npm run release:desktop:mac` producing `release/Producer-Player-0.1.0-mac-arm64.zip` and exiting successfully.
- Pushed fix to `main` and began periodic monitoring of workflow runs/logs.

---

## Retranscribed review note + execution kickoff

### Ethan message (retranscribed verbatim)

**Timestamp:** Sun 2026-03-08 00:20 GMT

```text
Okay. I'm gonna review it now. I'm gonna talk to you while I'm doing it, then you're gonna go off and make some changes. Naming convention, opinionated by design. It shouldn't say opinionated by design. Obviously, I'm just telling you that. I don't have some bullshit about build. Just keep it simple, minimal instructions, though, and the example. The music output is now in a little scroll thing. It's all a bit cramped. So it's a new naming convention thing. Open folder should say open in finder. It should only show when there is a folder path. When I play, it says this element has no supported sources. I want you to test it with the test audio file until it works. It should also support all audio formats. Actually, my AI music video studio projects on the computer Has a bunch of FFmpeg examples. I don't think you should be using FFmpeg. Maybe FFplay? I don't know. I'll do some research on that. Make sure it works for the player also. It should have, like, all the proper, like, audio player controls, like it's like should be a full on, like, Apple Music, like, skip next, like, easy scrub, play pause in the middle. Could have even have the repeat functionality where you can toggle it. Repeats repeats once and then whatever. Anything that a producer would need to play their song well. Maybe at the bottom of the screen, it can appear in like a full width, like, page width or, like, in the middle main content bit section at the bottom that pops up when you click on one of the tracks. Also, why is it called actual songs? It should just be called tracks. I don't know why I told you to make it called actual songs. Me rescan. Also, do we save the ordering, like, permanently in the proper place on the user's computer? Also, it's to say how many songs are in the library. Also, library shouldn't be called library at the top title. It should be called group slash album. Okay. Group slash album. Say that. No. More actual songs. Why do we have a mini actual song section and then we have the actual actual song section? It should only be one tracks section. This is duplicated. So the version history, it shows the old versions. Right? From the old folder. It should. Right? It doesn't already. I assume it does though. Currently, they all say one version. So I guess it's not using the old folder that it's made. Did you implement everything I said before, add everything to the plan? Did you actually add it to the plan, or did you not? I wanna know if you followed that instruction from ages ago, adding everything I'm saying to the plan m d or whatever, the file l c t. Search for that. Rescan. So it does rescan start from scratch. Right? Although it shouldn't delete the database that we've saved about the users, like, wherever the data is about the ordering and all that, actually. Actually, I don't know. Maybe keep how it is. What does organize do? Auto organize old versions. Why doesn't it have a tooltip? Are we using angular material for this UI? If not, well, why aren't we using tooltips anyway for all the checkboxes? Every single checkbox, I want you to check every single checkbox. You should be doing a to do list of all this, by the way, we need to do every single thing I'm saying. Checkbox. All the buttons, they're need tooltips that show instantly, to be honest. All fast, if possible. If not, fine. So I guess that's system tool tips. Yeah. Like, how do I when I I've added the folder. I don't see it in the paste folder path. I feel like we should always show the current oh, it's okay. I see. We don't need open folder and watch folders. So you already have music outputs below. Sorry. That that's not music. Music output is the name of my folder I selected. It's already got open and unlink. We can just unlink and start again. Unlink should have a confirmation dialogue because that's too risky. You know, are you sure this will delete all your data or whatever? By the way, you are only looking at the top level as you should be because it seems to be adding More files than just the top level. Or is that just me? Or is this old from before? I think unlink should start fresh. God. There's so many issues. Figure out how many sub agents we should do for all these or how we should communicate. Yeah. There's definitely some bugs around. I want you to do some e two e's. I have, like, a messy folder with a bunch of random folders with sub files. I wanna make sure it doesn't use those. And old is the correct thing used for version history, etcetera. All the issues I said I need to do, like, all these weird folder structure tests. Maybe in another sub agent. Spend a while on all of this, and get back to me when you're done.
```

---

## UI/player follow-up polish + bugfix pass (sub-agent run)

### Ethan message (verbatim)

**Timestamp:** Sun 2026-03-08 00:53 GMT

```text
Okay. I'm gonna review it now. I'm gonna talk to you while I'm doing it, then you're gonna go off and make some changes. Naming convention, opinionated by design. It shouldn't say opinionated by design. Obviously, I'm just telling you that. I don't have some bullshit about build. Just keep it simple, minimal instructions, though, and the example. The music output is now in a little scroll thing. It's all a bit cramped. So it's a new naming convention thing. Open folder should say open in finder. It should only show when there is a folder path. When I play, it says this element has no supported sources. I want you to test it with the test audio file until it works. It should also support all audio formats. Actually, my AI music video studio projects on the computer Has a bunch of FFmpeg examples. I don't think you should be using FFmpeg. Maybe FFplay? I don't know. I'll do some research on that. Make sure it works for the player also. It should have, like, all the proper, like, audio player controls, like it's like should be a full on, like, Apple Music, like, skip next, like, easy scrub, play pause in the middle. Could have even have the repeat functionality where you can toggle it. Repeats repeats once and then whatever. Anything that a producer would need to play their song well. Maybe at the bottom of the screen, it can appear in like a full width, like, page width or, like, in the middle main content bit section at the bottom that pops up when you click on one of the tracks. Also, why is it called actual songs? It should just be called tracks. I don't know why I told you to make it called actual songs. Me rescan. Also, do we save the ordering, like, permanently in the proper place on the user's computer? Also, it's to say how many songs are in the library. Also, library shouldn't be called library at the top title. It should be called group slash album. Okay. Group slash album. Say that. No. More actual songs. Why do we have a mini actual song section and then we have the actual actual song section? It should only be one tracks section. This is duplicated. So the version history, it shows the old versions. Right? From the old folder. It should. Right? It doesn't already. I assume it does though. Currently, they all say one version. So I guess it's not using the old folder that it's made. Did you implement everything I said before, add everything to the plan? Did you actually add it to the plan, or did you not? I wanna know if you followed that instruction from ages ago, adding everything I'm saying to the plan m d or whatever, the file l c t. Search for that. Rescan. So it does rescan start from scratch. Right? Although it shouldn't delete the database that we've saved about the users, like, wherever the data is about the ordering and all that, actually. Actually, I don't know. Maybe keep how it is. What does organize do? Auto organize old versions. Why doesn't it have a tooltip? Are we using angular material for this UI? If not, well, why aren't we using tooltips anyway for all the checkboxes? Every single checkbox, I want you to check every single checkbox. You should be doing a to do list of all this, by the way, we need to do every single thing I'm saying. Checkbox. All the buttons, they're need tooltips that show instantly, to be honest. All fast, if possible. If not, fine. So I guess that's system tool tips. Yeah. Like, how do I when I I've added the folder. I don't see it in the paste folder path. I feel like we should always show the current oh, it's okay. I see. We don't need open folder and watch folders. So you already have music outputs below. Sorry. That that's not music. Music output is the name of my folder I selected. It's already got open and unlink. We can just unlink and start again. Unlink should have a confirmation dialogue because that's too risky. You know, are you sure this will delete all your data or whatever? By the way, you are only looking at the top level as you should be because it seems to be adding More files than just the top level. Or is that just me? Or is this old from before? I think unlink should start fresh. God. There's so many issues. Figure out how many sub agents we should do for all these or how we should communicate. Yeah. There's definitely some bugs around. I want you to do some e two e's. I have, like, a messy folder with a bunch of random folders with sub files. I wanna make sure it doesn't use those. And old is the correct thing used for version history, etcetera. All the issues I said I need to do, like, all these weird folder structure tests. Maybe in another sub agent. Spend a while on all of this, and get back to me when you're done.
```

### Assistant implementation summary (this run)

- Simplified naming helper copy and removed "opinionated by design" phrase.
- Renamed user-facing labels: `Actual Songs` -> `Tracks`; `Library` -> `Group / Album`.
- Removed duplicated mini tracks section from left sidebar.
- Renamed folder action button to `Open in Finder` and only render it when a folder path exists.
- Reworked player into a bottom dock in main panel with producer-oriented controls: previous, play/pause, next, scrubber, repeat cycle (Off/One/All), finder reveal for current file.
- Verified playback using generated valid WAV test fixtures in E2E, replacing invalid text-stub audio files.
- Added track count display in Group / Album header.
- Preserved order persistence in userData state file and verified rescan does not wipe ordering.
- Added/expanded tooltip coverage across buttons and checkbox controls (including auto-organize checkbox input itself).
- Added unlink confirmation dialog with warning and explicit file-safety language.
- Changed scan behavior to top-level + explicit `old/` folder only (non-recursive for arbitrary nested dirs).
- Integrated `old/` files into version history display and added archived indicator label.
- Expanded supported extension list to broader common formats (`wav`, `aiff`, `aif`, `flac`, `mp3`, `m4a`, `aac`, `ogg`, `opus`, `webm`, `mp4`) while still relying on Chromium codec support at runtime.
