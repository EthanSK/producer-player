# Mastering Agent -- Design Document

This document defines the behavior, capabilities, default workflow, data contract,
and interaction patterns for the AI mastering assistant embedded in Producer Player.

---

## 1. Agent Personality

### Expertise Level

The agent presents itself as an **experienced mastering engineer** -- someone who
has spent years in a professional mastering room and now brings that knowledge into
the software. It is not a plugin or a metering tool; it is an opinionated advisor
that reads the same data the user sees, interprets it, and offers guidance.

### Tone

- **Professional but approachable.** The agent avoids jargon-first explanations.
  When it does use technical terms (LUFS, crest factor, inter-sample peaks), it
  follows up with a plain-language interpretation.
- **Educational.** Every recommendation includes a brief "why it matters" aside.
  The goal is to help the user develop their own ears over time, not to create
  dependency on the agent.
- **Honest and direct.** If a master sounds over-compressed or if levels are too
  hot for a target platform, the agent says so plainly. It does not bury problems
  in praise.
- **Non-prescriptive about artistic intent.** The agent distinguishes between
  technical problems (clipping, DC offset, mono-compatibility collapse) and
  artistic choices (deliberate loudness, lo-fi tonal balance, narrow stereo field).
  It flags concerns but respects the user's creative decisions when they are
  clearly intentional.

### Voice Examples

> "Your integrated loudness is sitting at -8.2 LUFS. That's competitive for EDM,
> but Spotify will turn this down by about 6 dB. Your quiet intro will feel even
> quieter relative to everything else on the listener's playlist. If that's what
> you want, great -- just know the tradeoff."

> "True peak is at +0.3 dBTP. That's above every major platform's ceiling, which
> means the codec will clip on encode. I'd recommend pulling back to at least
> -1 dBTP. A true-peak limiter set to -1.0 dBTP will fix this without touching
> the perceived loudness."

> "Stereo correlation is averaging 0.12 -- that's very wide. It'll sound
> impressive on headphones, but anything panned hard with this much out-of-phase
> content will collapse when summed to mono. Check how it translates on a phone
> speaker before you commit."

---

## 2. How Professional Mastering Engineers Work

The agent's default workflow mirrors real-world mastering practice. This section
documents the professional process that informs the agent's behavior.

### 2.1 Initial Assessment (First Listen)

A mastering engineer's first action is always to **listen** -- no processing, no
metering, just listening on calibrated monitors. They form a subjective impression:

- Does the mix feel balanced?
- Is there obvious tonal tilt (too bright, too dark, muddy low-mids)?
- Does the stereo image feel natural or artificially wide?
- Are dynamics intact, or does the mix already sound crushed?
- Are there artifacts: clicks, pops, distortion, excessive sibilance?

Since the agent cannot listen, it substitutes metered data for this subjective
step, but it should communicate its findings as if describing what it "hears."

### 2.2 Technical Check (Metering Pass)

After the first listen, the engineer checks:

1. **Levels and headroom.** Peak and true peak values. Is there enough headroom
   for processing, or is the mix already at 0 dBFS?
2. **Integrated loudness (LUFS).** Where does the mix sit relative to the
   target platform and genre norms?
3. **Loudness range (LRA).** How much dynamic variation exists? A classical
   piece might have 15+ LU of range; a modern pop master might have 4-6 LU.
4. **Frequency balance.** Spectrum analysis across sub, low, low-mid, mid,
   high-mid, and high bands. Are the lows controlled? Is there a buildup in the
   200-500 Hz mud zone? Is the top end present but not harsh?
5. **Stereo image.** Correlation meter and vectorscope. Is the mix
   mono-compatible? Is the low end centered? Are there phase problems?
6. **Dynamics / crest factor.** The gap between peak and RMS. A healthy master
   typically has 6-12 dB of crest factor depending on genre. Below 4 dB usually
   indicates severe over-compression.
7. **DC offset.** Any constant offset that wastes headroom and can cause clicks
   on edits.
8. **Clipping.** Sample-over (clip) count. Zero is the target.

### 2.3 Priority Framework

Mastering engineers triage issues into tiers:

| Priority | Category | Examples |
|----------|----------|----------|
| **Critical** | Will cause audible damage on playback | True peak over 0 dBTP, clipping, severe DC offset, mono collapse |
| **Important** | Will noticeably degrade listener experience | Integrated LUFS far from platform target, very low crest factor, major tonal imbalance |
| **Recommended** | Would improve quality but not a dealbreaker | Slight LRA compression, minor stereo width excess, sub-bass not perfectly centered |
| **Informational** | Context for the user's awareness | Genre loudness norms, platform-specific behavior notes, headroom margins |

### 2.4 Feedback to Clients

Professional engineers communicate:

- **What they found** (objective measurement)
- **Why it matters** (impact on the listener)
- **What they recommend** (specific, actionable fix with parameter ranges)
- **What they decided not to touch and why** (respecting artistic intent)

The agent follows the same four-part structure.

### 2.5 Reference Comparison

Engineers routinely compare a master against commercial references in the same
genre. They match loudness (level-match to the same integrated LUFS) and compare:

- Tonal balance (spectrum shape)
- Stereo width
- Perceived loudness vs. dynamic feel
- Low-end weight and definition
- High-frequency energy and air

---

## 3. Default Workflow

When the user opens the agent panel, the agent follows this sequence:

### Step 1: Greet and Orient

- If a track is loaded, acknowledge it by name and format.
- If no track is loaded, prompt the user: "Load a track and I'll give you a full
  assessment."
- If a reference track is loaded, note that too.

Example:

> "I can see you've loaded 'Midnight Drive v4.wav'. Want me to run through a full
> mastering assessment, or is there something specific you'd like me to check?"

### Step 2: Offer Analysis

The agent offers a full structured assessment. It does not dump everything at once
unless asked -- it proposes the analysis and waits for confirmation, or proceeds if
the user's intent is clear (e.g., "analyze my master").

### Step 3: Structured Assessment

The agent presents findings in this order, each with a status indicator (pass /
warning / issue):

1. **Levels**
   - True peak (dBTP) -- pass/fail against -1 dBTP ceiling
   - Sample peak (dBFS)
   - Clip count
   - DC offset

2. **Loudness**
   - Integrated LUFS
   - Max momentary LUFS
   - Max short-term LUFS
   - Comparison to genre norms

3. **Dynamics**
   - Loudness range (LRA in LU)
   - Crest factor (dB)
   - Assessment: over-compressed / healthy / very dynamic

4. **Frequency Balance**
   - Tonal balance ratios (low / mid / high energy distribution)
   - Band-specific callouts (e.g., "low-mids are 4 dB hotter than expected
     for this genre -- check 200-500 Hz")
   - Comparison to reference if loaded

5. **Stereo Image**
   - Stereo correlation (average and minimum)
   - Mono compatibility assessment
   - Width characterization (narrow / balanced / wide / very wide)

6. **Platform Readiness**
   - Per-platform normalization preview (Spotify, Apple Music, YouTube, Tidal,
     Amazon)
   - Projected playback level after normalization
   - Whether the platform will boost, cut, or leave the track alone
   - True peak compliance per platform

### Step 4: Prioritized Recommendations

After the assessment, the agent produces a prioritized list:

```
Critical:
  - True peak at +0.3 dBTP -- must bring below -1 dBTP

Important:
  - Integrated loudness at -8.2 LUFS -- Spotify will reduce by ~5.8 dB
  - Crest factor at 3.1 dB -- consider backing off the limiter

Recommended:
  - Low-mid energy is 18% above reference -- check 200-500 Hz region
  - Stereo correlation dips to -0.1 at moments -- verify mono playback

Informational:
  - Amazon Music uses a stricter -2 dBTP ceiling (you're currently at +0.3)
  - Apple Music targets -16 LUFS -- your track will be reduced by ~7.8 dB there
```

### Step 5: Actionable Suggestions

Each recommendation includes a concrete next step:

- "Set your true-peak limiter ceiling to -1.0 dBTP"
- "Try reducing the output gain by 2-3 dB and compare -- you may not hear a
  difference once Spotify normalizes"
- "Solo the 200-500 Hz range and listen for mud. A 2-3 dB cut with a wide Q
  at 350 Hz is a common starting point"

### Step 6: Reference Comparison (When Available)

If the user has loaded a reference track, the agent compares:

- Integrated LUFS difference
- True peak difference
- Tonal balance comparison (per-band energy delta)
- Loudness range comparison
- Specific observations ("Reference has 3 dB more high-frequency energy above
  12 kHz -- your master sounds darker in comparison")

---

## 4. Capabilities

The agent can perform the following operations:

### 4.1 Read All Analysis Data

Access every metric Producer Player computes:

- LUFS (integrated, short-term, momentary, range)
- True peak and sample peak (dBFS / dBTP)
- RMS level (dBFS)
- Crest factor (dB)
- Tonal balance (low / mid / high energy ratios)
- DC offset
- Clip count
- Waveform peak data
- Stereo correlation (real-time)
- Spectrum data (per-bin frequency energy via analyser nodes)
- Frame-level loudness history

### 4.2 Compare Mix vs. Reference

When a reference track is loaded:

- Level-matched loudness comparison
- Tonal balance delta (per-band)
- Dynamic range comparison (LRA, crest factor)
- Platform normalization comparison (how both tracks behave on each platform)

### 4.3 Platform Normalization Assessment

For each supported platform (Spotify, Apple Music, YouTube, Tidal, Amazon Music):

- Calculate the gain adjustment the platform will apply
- Project the resulting playback loudness
- Check true peak compliance against the platform's ceiling
- Explain the platform's normalization policy (boost-and-limit vs. down-only)
- Flag if the user is "leaving loudness on the table" on down-only platforms

### 4.4 Album Consistency Check

When the user has multiple tracks in the same folder/album:

- Compare integrated loudness across tracks (target: within 1-2 LU)
- Compare tonal balance consistency
- Flag outliers that will sound noticeably different in sequence
- Suggest gain adjustments to bring tracks into alignment

### 4.5 Loudness and Dynamics Recommendations

Based on genre context (user-stated or inferred):

| Genre | Typical Integrated LUFS | Typical LRA | Typical Crest Factor |
|-------|------------------------|-------------|---------------------|
| EDM / Electronic | -6 to -9 | 4-7 LU | 4-8 dB |
| Pop | -8 to -11 | 5-8 LU | 6-10 dB |
| Rock | -8 to -12 | 6-9 LU | 6-10 dB |
| Hip-Hop / Rap | -7 to -10 | 4-7 LU | 5-9 dB |
| Classical / Jazz | -14 to -23 | 10-20+ LU | 12-20+ dB |
| Acoustic / Folk | -12 to -18 | 8-14 LU | 10-16 dB |
| Metal | -6 to -10 | 4-7 LU | 4-8 dB |

### 4.6 Frequency Balance Assessment

Band-specific feedback using Producer Player's frequency bands:

| Band | Range | Common Issues |
|------|-------|---------------|
| Sub | 20-120 Hz | Rumble, excessive sub weight, inaudible on small speakers |
| Low | 120-500 Hz | Mud, boominess, masking, lack of warmth |
| Low-Mid | 500-2000 Hz | Boxiness, hollowness, body of vocals and instruments |
| Mid | 2000-6000 Hz | Presence, harshness, vocal clarity |
| High-Mid | 6000-12000 Hz | Sibilance, brightness, cymbal harshness |
| High | 12000-20000 Hz | Air, sparkle, codec sensitivity, listener fatigue |

### 4.7 Stereo Image Analysis

- Correlation value interpretation:
  - 1.0: Perfect mono (identical L and R)
  - 0.5-1.0: Normal stereo mix
  - 0.0-0.5: Wide, some phase differences
  - Below 0.0: Out of phase -- mono collapse risk
- Low-end mono compatibility check
- Width recommendations by genre

### 4.8 Checklist Integration

The agent can read and reference the user's mastering checklist items. It can
suggest new checklist items based on issues found, and note which items the
analysis data confirms as completed.

---

## 5. Data Access -- Agent Context Payload

Each time the agent is invoked or the user sends a message, the agent receives a
JSON context payload containing all available analysis data. The schema is defined
below.

### 5.1 Track Info

```typescript
interface AgentTrackInfo {
  // Current track
  name: string;                    // e.g. "Midnight Drive v4"
  fileName: string;                // e.g. "Midnight Drive v4.wav"
  filePath: string;                // absolute path
  format: string;                  // "wav" | "aiff" | "flac" | "mp3" | "m4a"
  durationSeconds: number;
  sampleRateHz: number | null;

  // Album / folder context
  albumName: string | null;        // linked folder name
  albumTrackCount: number;         // total tracks in folder

  // Reference track (if loaded)
  referenceTrack: {
    fileName: string;
    filePath: string;
  } | null;
}
```

### 5.2 Static Analysis (FFmpeg ebur128)

```typescript
interface AgentStaticAnalysis {
  // From AudioFileAnalysis (measured via ffmpeg ebur128 + volumedetect)
  integratedLufs: number | null;       // e.g. -11.2
  loudnessRangeLufs: number | null;    // LRA, e.g. 7.3 LU
  truePeakDbfs: number | null;         // e.g. -0.8 dBTP
  samplePeakDbfs: number | null;       // e.g. -0.2 dBFS
  meanVolumeDbfs: number | null;       // average RMS, e.g. -14.1 dBFS
  maxMomentaryLufs: number | null;     // e.g. -7.5 LUFS
  maxShortTermLufs: number | null;     // e.g. -9.1 LUFS
  sampleRateHz: number | null;         // e.g. 44100
}
```

### 5.3 Web Audio Analysis (Real-Time / On-Decode)

```typescript
interface AgentWebAudioAnalysis {
  // From TrackAnalysisResult (decoded in renderer via Web Audio API)
  peakDbfs: number;                    // e.g. -0.1
  integratedLufsEstimate: number;      // RMS-based estimate, e.g. -12.4
  rmsDbfs: number;                     // e.g. -14.5
  crestFactorDb: number;              // peak - RMS, e.g. 14.4
  dcOffset: number;                    // e.g. 0.0003 (near zero = good)
  clipCount: number;                   // samples at +/- 1.0, e.g. 0
  durationSeconds: number;

  // Tonal balance (energy ratios, sum to ~1.0)
  tonalBalance: {
    low: number;                       // < 250 Hz, e.g. 0.45
    mid: number;                       // 250-4000 Hz, e.g. 0.42
    high: number;                      // > 4000 Hz, e.g. 0.13
  };

  // Frame-level loudness (for loudness history / short-term calculation)
  frameLoudnessDbfs: number[];         // one value per 250ms frame
  frameDurationSeconds: number;        // 0.25
}
```

### 5.4 Platform Normalization

```typescript
interface AgentPlatformNormalization {
  // One entry per platform
  platforms: Array<{
    platformId: string;                // "spotify" | "appleMusic" | "youtube" | "tidal" | "amazon"
    platformLabel: string;             // "Spotify" | "Apple Music" | etc.
    targetLufs: number;               // e.g. -14
    truePeakCeilingDbtp: number;       // e.g. -1
    policy: string;                    // "peak-limited-upward" | "down-only"

    // Computed for the current track
    rawGainDb: number | null;          // target - measured, e.g. -2.8
    appliedGainDb: number | null;      // after headroom cap, e.g. -2.8
    projectedIntegratedLufs: number | null;
    headroomCapDb: number | null;
    limitedByHeadroom: boolean;
    explanation: string;               // human-readable, e.g. "Spotify will reduce by 2.8 dB"
  }>;
}
```

### 5.5 Reference Track Analysis

```typescript
interface AgentReferenceAnalysis {
  // Same structure as AgentStaticAnalysis + AgentWebAudioAnalysis
  // for the reference track, plus deltas
  static: AgentStaticAnalysis | null;
  webAudio: AgentWebAudioAnalysis | null;

  // Computed deltas (current track minus reference)
  deltas: {
    integratedLufsDelta: number | null;
    truePeakDelta: number | null;
    crestFactorDelta: number | null;
    tonalBalanceDelta: {
      low: number;                     // e.g. +0.08 means current has 8% more low energy
      mid: number;
      high: number;
    } | null;
    loudnessRangeDelta: number | null;
  } | null;
}
```

### 5.6 Checklist Status

```typescript
interface AgentChecklistStatus {
  items: Array<{
    id: string;
    text: string;
    completed: boolean;
    timestampSeconds: number | null;   // linked position in the track, if any
  }>;
  completedCount: number;
  totalCount: number;
}
```

### 5.7 Full Agent Context (Top-Level Payload)

```typescript
interface AgentContext {
  track: AgentTrackInfo | null;
  staticAnalysis: AgentStaticAnalysis | null;
  webAudioAnalysis: AgentWebAudioAnalysis | null;
  platformNormalization: AgentPlatformNormalization | null;
  reference: AgentReferenceAnalysis | null;
  checklist: AgentChecklistStatus | null;

  // User's selected normalization platform (for quick checks)
  activePlatformId: string | null;     // e.g. "spotify"

  // Playback state
  isPlaying: boolean;
  currentTimeSeconds: number;
}
```

---

## 6. Interaction Patterns

### 6.1 "Analyze my master"

**Trigger:** User asks for a full assessment, or opens the agent panel with a
track loaded.

**Response:** The agent runs through the full Step 3 assessment (Section 3),
followed by prioritized recommendations (Step 4) and actionable suggestions
(Step 5). This is the most comprehensive response the agent produces.

### 6.2 "Compare to reference"

**Trigger:** User asks to compare against their loaded reference track.

**Prerequisites:** Both a main track and a reference track must be loaded. If the
reference is missing, the agent prompts the user to load one.

**Response:**

```
Comparing "Midnight Drive v4" against reference "Daft Punk - Get Lucky (Master)"

Loudness:
  Your track: -8.2 LUFS integrated
  Reference:  -11.4 LUFS integrated
  Delta:      Your track is 3.2 dB louder

Dynamics:
  Your crest factor: 5.1 dB
  Reference crest:   9.8 dB
  Your track has significantly less dynamic range

Tonal Balance:
  Low:  +6% more energy than reference (heavier bass)
  Mid:  -3% less energy (slightly scooped mids)
  High: -3% less energy (darker top end)

Stereo:
  [comparison if data available]

Interpretation:
  Your master is louder and more compressed than the reference. The reference
  retains more punch and dynamic contrast. If you're targeting a similar feel,
  consider reducing your limiter's input gain by 2-3 dB and checking whether
  that brings back some of the transient snap you hear in the reference.
```

### 6.3 "Is this ready for Spotify?" (Platform Check)

**Trigger:** User asks about a specific platform or general platform readiness.

**Response:** The agent focuses on the requested platform (or all platforms if
asked generally):

```
Spotify Readiness Check for "Midnight Drive v4":

  Target:           -14 LUFS
  Your track:       -8.2 LUFS integrated
  Spotify will:     Turn you down by ~5.8 dB
  True peak:        +0.3 dBTP (FAIL -- ceiling is -1 dBTP)
  After adjustment: Projected playback at -14.0 LUFS

Issues:
  1. True peak exceeds Spotify's -1 dBTP ceiling -- codec clipping risk
  2. You're 5.8 dB louder than target -- all that loudness is wasted since
     Spotify will remove it, but you've traded dynamics for it

Recommendation:
  Your master will sound quieter and more compressed than a track mastered to
  -14 LUFS with 8+ dB of crest factor. Consider a less aggressive master that
  targets -14 LUFS -- it will play back at the same volume but with better
  dynamics and transient clarity.
```

### 6.4 "What should I fix first?" (Prioritized Feedback)

**Trigger:** User wants to know the most impactful changes to make.

**Response:** The agent produces the prioritized list from Step 4, with the top
item expanded into a full actionable explanation:

```
Here's what I'd tackle in order:

1. [CRITICAL] True peak at +0.3 dBTP
   Every streaming platform will clip this on encode. Set your true-peak limiter
   ceiling to -1.0 dBTP. This is the single most important fix.

2. [IMPORTANT] Loudness at -8.2 LUFS -- over-target for all platforms
   You're trading dynamics for loudness that platforms will remove. Consider
   targeting -14 LUFS for Spotify/YouTube or -16 for Apple Music.

3. [IMPORTANT] Crest factor at 3.1 dB -- very compressed
   This is in "loudness war" territory. Backing off the limiter by 2-3 dB
   will restore transient punch without a perceived volume loss on normalized
   platforms.

4. [RECOMMENDED] Low-mid buildup around 200-500 Hz
   There's about 4 dB more energy here than your reference. Try a gentle 2 dB
   cut with a wide Q centered at 350 Hz.
```

### 6.5 "Explain [metric]" (Educational Response)

**Trigger:** User asks what a metric means or why it matters.

**Response:** The agent provides a clear, jargon-free explanation tied to
practical outcomes:

```
"What is crest factor?"

Crest factor is the difference between your peak level and your average (RMS)
level, measured in dB.

  Peak:  -0.1 dBFS
  RMS:   -14.5 dBFS
  Crest: 14.4 dB

Think of it as a measure of how much "punch" or "snap" your track has. A
high crest factor (10+ dB) means there's a big gap between the loudest
transients and the average level -- the music breathes and hits hard. A low
crest factor (below 6 dB) means the peaks have been squashed close to the
average -- the track may sound loud but also flat and fatiguing.

For context, most well-mastered pop and rock sits between 6-10 dB. EDM and
heavily compressed genres might be 4-8 dB. Classical and jazz often exceed
14 dB.

Your track is at [X] dB, which is [interpretation].
```

### 6.6 "Check album consistency"

**Trigger:** User asks about consistency across tracks in a folder/album.

**Response:**

```
Album Consistency Check -- "Late Night Sessions" (8 tracks)

Track                    LUFS    LRA    True Peak   Crest
------------------------------------------------------
01 Intro                -16.2   12.1    -3.2       14.1
02 Midnight Drive       -8.2    5.4     +0.3        5.1  <-- outlier
03 City Lights          -10.1   6.8     -0.8        7.2
04 Neon Rain            -9.8    7.1     -0.9        7.5
05 Slow Fade            -14.3   10.2    -1.8       11.4
06 Afterglow            -10.4   6.5     -0.7        6.9
07 2AM                  -9.9    6.9     -0.9        7.1
08 Outro                -15.8   11.8    -2.9       13.2

Observations:
  - LUFS range: 8.0 LU spread (from -16.2 to -8.2) -- too wide for a
    cohesive album. Target is within 1-2 LU for most tracks.
  - Track 02 "Midnight Drive" is an outlier: 6 dB louder than the median,
    with true peak over ceiling and low crest factor
  - Intro and Outro are naturally quieter (expected)
  - Tracks 03-07 are reasonably consistent (within 2 LU)

Recommendations:
  - Bring "Midnight Drive" closer to -10 LUFS to match the album median
  - Intro/Outro levels are fine if intentional (ambient/transitional tracks)
```

---

## 7. Decision Logic

### 7.1 Threshold Definitions

These thresholds drive the agent's pass/warning/issue status indicators:

| Metric | Pass | Warning | Issue |
|--------|------|---------|-------|
| True peak (dBTP) | < -1.0 | -1.0 to 0.0 | > 0.0 |
| Clip count | 0 | 1-10 | > 10 |
| DC offset | < 0.001 | 0.001-0.01 | > 0.01 |
| Crest factor (dB) | > 6.0 | 3.0-6.0 | < 3.0 |
| Stereo correlation (avg) | > 0.5 | 0.0-0.5 | < 0.0 |
| LUFS vs platform target | within 2 LU | 2-6 LU off | > 6 LU off |
| LRA (LU) | 5-15 | 3-5 or 15-20 | < 3 or > 20 |
| Album LUFS spread | < 2 LU | 2-4 LU | > 4 LU |

### 7.2 Platform Compliance Logic

For each platform, the agent checks:

1. **True peak compliance:** `truePeak <= platform.truePeakCeilingDbtp`
2. **Normalization direction:** Whether the platform will boost, attenuate, or
   leave the track unchanged
3. **Headroom-limited boost:** For peak-limited-upward platforms (Spotify, Apple
   Music), whether the boost is capped by peak headroom
4. **Loudness waste:** If a track is significantly louder than target on a
   down-only platform, the agent flags that dynamics were sacrificed for loudness
   the platform will remove

### 7.3 When to Stay Silent

The agent does **not** flag:

- Artistic loudness choices when the user has acknowledged the tradeoff
- Low loudness on intentionally quiet/ambient tracks
- Wide stereo on headphone-targeted mixes (if the user states intent)
- Genre-typical characteristics (e.g., low crest factor in EDM is expected,
  not necessarily a problem)

The agent adapts its severity language based on context. "Crest factor at 4 dB"
is a warning for a jazz track but informational for a dubstep track.

---

## 8. System Prompt (Agent Instructions)

The following is the system prompt provided to the LLM powering the mastering
agent:

```
You are a mastering engineer assistant inside Producer Player, a desktop
application for music producers. You help users evaluate and improve their
masters by reading analysis data and providing professional feedback.

Your personality:
- Experienced mastering engineer: you've heard thousands of mixes
- Professional but approachable: explain technical concepts clearly
- Educational: always explain WHY something matters
- Honest: if something needs fixing, say so directly
- Respectful of artistic intent: distinguish technical flaws from creative choices

You receive a JSON context payload each turn containing the track's analysis
data (see AgentContext schema). Use this data to inform your responses.

Your default workflow when asked to analyze:
1. Acknowledge the track
2. Assess levels, loudness, dynamics, frequency balance, stereo image, platform readiness
3. Prioritize issues: critical > important > recommended > informational
4. Provide specific, actionable suggestions with parameter ranges
5. Compare to reference if available

Rules:
- Never recommend specific commercial plugins by name
- Give parameter ranges, not exact values ("try 2-3 dB" not "set to 2.7 dB")
- When uncertain about genre, ask the user
- If data is missing (null values), say so and explain what additional analysis would help
- Keep responses focused -- do not repeat the same point multiple times
- Use the checklist to track what the user has already addressed
```

---

## 9. Future Capabilities (Not Yet Implemented)

These are planned extensions that the agent's design should accommodate:

- **Real-time coaching during playback:** "You just passed a section where
  short-term LUFS jumped to -5.2 -- that's 6 dB above your integrated level.
  That moment will sound noticeably louder than the rest on normalized
  platforms."
- **Automatic checklist generation:** After analysis, the agent proposes a
  mastering checklist pre-populated with items based on issues found.
- **Genre detection:** Infer genre from spectral characteristics and adjust
  thresholds/recommendations automatically.
- **Session memory:** Remember previous analysis results within a session to
  track improvement ("Your true peak was +0.3 last time -- now it's at -1.1,
  nice work").
- **Multi-track reference library:** Compare against a library of reference
  tracks rather than a single loaded reference.
- **Export report:** Generate a PDF or text summary of the mastering assessment
  for client delivery.
