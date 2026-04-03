# Producer Player — Explainer Video Script

Target length: **60–90 seconds**
Format: Screen recording with text overlays / voiceover narration
Resolution: 1920x1080 (16:9)

---

## Scene 1 — The Problem (0:00–0:12)

**Visual:** A Finder/Explorer window showing a folder full of exported audio files —
`Song A v1.wav`, `Song A v2.wav`, `Song A v3 final.wav`, `Song A v3 final FINAL.wav`, etc.

**Narration / text overlay:**
> You keep bouncing new passes out of your DAW.
> Within a week the folder is a mess and you can't remember which version was the good one.

---

## Scene 2 — Open Producer Player (0:12–0:20)

**Visual:** Launch Producer Player. Point it at a project folder. Songs appear grouped by name with version badges (v1, v2, v3).

**Narration:**
> Producer Player scans your export folder and groups versions under each song automatically.
> No renaming. No manual tagging.

---

## Scene 3 — Playback & Comparison (0:20–0:35)

**Visual:** Click play on a track. Show play/pause, next/previous, scrub bar, volume slider. Switch between v1 and v2 to compare.

**Narration:**
> Play any version directly. Scrub, skip, repeat — standard transport controls.
> Flip between versions instantly to hear what changed.

---

## Scene 4 — Album Order (0:35–0:45)

**Visual:** Drag tracks into album sequence. Close and reopen the app — order persists.

**Narration:**
> Drag songs into your album order. It sticks through rescans, restarts, and new exports.
> Export Latest gives you a numbered folder ready for distribution or mastering handoff.

---

## Scene 5 — Mastering & Reference A/B (0:45–1:00)

**Visual:** Open the mastering/reference workspace. Load a reference track. Show LUFS/peak meters, tonal balance. Click the A/B toggle between mix and reference. Show normalization presets (Spotify, Apple Music, YouTube, TIDAL).

**Narration:**
> Load a reference track and A/B it against your mix in one click.
> See measured loudness, peaks, and tonal balance.
> Preview how your track will sound on Spotify, Apple Music, YouTube, or TIDAL
> with platform normalization presets.

---

## Scene 6 — Checklist & Rating (1:00–1:10)

**Visual:** Show per-song checklist items being ticked off, and the 1–10 rating slider.

**Narration:**
> Track your finishing progress with per-song checklists and a quick rating slider.

---

## Scene 7 — Wrap-up & CTA (1:10–1:20)

**Visual:** Return to the main view. Show the GitHub releases page briefly.

**Narration:**
> Producer Player is source-available under the PolyForm Noncommercial license.
> Download it now from GitHub Releases — macOS, Linux, and Windows snapshots available.

**Text overlay:** `github.com/EthanSK/producer-player`

---

## Production Notes

- **Screen recording:** Record from the live app on macOS using the real UI.
- **Audio:** Voiceover or text-only captions both work. If voiceover, keep it conversational.
- **Music:** Optional subtle background beat (royalty-free or original).
- **Render:** Export as MP4 (H.264, 1080p) and upload to GitHub Releases or embed on the landing page.

### Embedding on the landing page

Once the video file exists, replace the placeholder in `site/index.html` (`#explainer-video`) with:

```html
<video controls preload="metadata" poster="./assets/screenshots/app-hero.png">
  <source src="./assets/video/producer-player-explainer.mp4" type="video/mp4" />
</video>
```

Or if hosted on YouTube:

```html
<iframe
  src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
  title="Producer Player explainer"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
></iframe>
```
