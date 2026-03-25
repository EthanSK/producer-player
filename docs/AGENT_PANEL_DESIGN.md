# Agent Chat Panel — Design Document

> Consolidated requirements for the AI agent chat panel in Producer Player.
> Sources: tasks 46–50, T3 code research, existing codebase patterns.

---

## 1. Architecture

### 1.1 Provider Abstraction

Producer Player follows a **BYOS (Bring Your Own Subscription)** model. The app does not proxy API calls or manage billing — the user must have one of the supported CLIs installed and authenticated on their machine.

| Provider | CLI requirement | SDK / integration |
|----------|----------------|-------------------|
| Claude | `claude` CLI installed + authenticated | Claude SDK (primary) |
| Codex | `codex` CLI installed + authenticated | Optional, secondary |

A `ProviderAdapter` interface abstracts the differences:

```ts
interface ProviderAdapter {
  id: 'claude' | 'codex';
  displayName: string;
  isAvailable(): Promise<boolean>;   // CLI found + auth valid
  startSession(opts: AgentSessionOpts): AgentSession;
}

interface AgentSession {
  sendTurn(message: string, context?: AgentContext): AsyncIterable<AgentEvent>;
  interrupt(): void;
  respondToApproval(id: string, decision: 'allow' | 'deny'): void;
  destroy(): void;
}
```

### 1.2 Process Model

```
┌─────────────────────────────────────┐
│  Renderer (React)                   │
│  ┌───────────────────────────────┐  │
│  │  AgentPanel component         │  │
│  │  - ChatTimeline               │  │
│  │  - ChatComposer               │  │
│  │  - ApprovalBanner             │  │
│  └───────────┬───────────────────┘  │
│              IPC                     │
├──────────────┼──────────────────────┤
│  Main process│(Electron)            │
│  ┌───────────┴───────────────────┐  │
│  │  AgentService                 │  │
│  │  - spawns CLI subprocess      │  │
│  │  - manages session lifecycle  │  │
│  │  - has filesystem access      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

The agent **must** run in the Electron main process because it needs filesystem access (reading audio files, analysis data, app state). The renderer communicates exclusively via IPC, consistent with the existing `ProducerPlayerBridge` pattern in `apps/electron/src/preload.ts`.

### 1.3 IPC Channels

New channels to add to `IPC_CHANNELS` in `@producer-player/contracts`:

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `AGENT_START_SESSION` | renderer → main | `{ provider, mode, systemPrompt? }` | Initialize agent session |
| `AGENT_SEND_TURN` | renderer → main | `{ message, context? }` | Send user message |
| `AGENT_INTERRUPT` | renderer → main | `void` | Stop current generation |
| `AGENT_RESPOND_APPROVAL` | renderer → main | `{ approvalId, decision }` | Accept/deny tool use |
| `AGENT_DESTROY_SESSION` | renderer → main | `void` | Tear down session |
| `AGENT_EVENT` | main → renderer | `AgentEvent` | Stream of agent events |
| `AGENT_CHECK_PROVIDER` | renderer → main | `{ provider }` | Check if CLI is available |

### 1.4 Event Stream

`AgentEvent` is a discriminated union streamed from main → renderer:

```ts
type AgentEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool-use-start'; toolName: string; toolId: string; input: unknown }
  | { type: 'tool-use-result'; toolId: string; output: unknown }
  | { type: 'approval-request'; approvalId: string; toolName: string; description: string }
  | { type: 'turn-complete'; usage?: TokenUsage }
  | { type: 'error'; code: string; message: string }
  | { type: 'session-ended'; reason: string };

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}
```

---

## 2. Chat Panel UI

### 2.1 Layout

- **Position:** Collapsible panel anchored to the bottom-right of the app window.
- **Toggle:** Floating button (chat bubble icon) with an **"Experimental"** badge displayed on first use and in the panel header.
- **Resize:** Drag handle on the top and left edges. Panel remembers its last size.
- **Collapse:** Click the toggle button or press `Esc` to collapse. Panel slides down/right with a CSS transition.
- **Z-index:** Panel floats above the main content but below modals/dialogs.

### 2.2 Message Timeline

- Rendered with `@tanstack/react-virtual` for virtualized scrolling (handles long conversations without DOM bloat).
- Each message bubble shows:
  - **Role indicator:** User / Agent / System
  - **Timestamp** (relative, e.g., "2m ago")
  - **Content:** Rendered Markdown (see Section 2.4)
  - **Copy button** on hover
- Auto-scrolls to bottom on new messages, unless the user has scrolled up (sticky-scroll logic).

### 2.3 Chat Composer

- Multi-line text input (`<textarea>` with auto-resize).
- **Send button** (right side) — enabled when input is non-empty and agent is not mid-turn.
- `Enter` sends, `Shift+Enter` inserts newline.
- **Microphone button** for voice input (see Section 5).
- **Model/provider picker** — dropdown or segmented control showing available providers. Grayed-out entries for CLIs that are not installed, with a tooltip explaining how to install.

### 2.4 Markdown Rendering

Use a lightweight Markdown renderer (e.g., `react-markdown` + `remark-gfm`):

- Headings, bold, italic, lists, links
- Fenced code blocks with syntax highlighting (`highlight.js` or `shiki`)
- Tables (GFM)
- Inline code
- Images (rendered inline; agent may return spectrograms or charts)
- LaTeX / math blocks (optional, low priority)

### 2.5 Approval Banner

When the agent requests tool use in UI interaction mode:

- A banner slides in above the composer.
- Shows: tool name, description of what it will do, and three buttons: **Allow**, **Deny**, **Allow All** (for this session).
- The chat timeline shows a pending-approval indicator on the relevant message.
- If the user does not respond within 60 seconds, the request auto-denies with a message.

---

## 3. Interaction Modes

### 3.1 Analysis Mode (Default)

**Purpose:** Answer questions about the user's tracks, mastering decisions, loudness, spectrum, etc.

**Context delivery:**
- On session start (and on each turn if data has changed), the main process assembles a JSON context object:

```ts
interface AnalysisContext {
  currentTrack: {
    name: string;
    filePath: string;
    durationMs: number;
    lufsIntegrated: number;
    lufsShortTermMax: number;
    lufsMomentaryMax: number;
    truePeakDbfs: number;
    crestFactorDb: number;
    stereoCorrelation: number;
    spectrumData?: Float32Array; // summary bins
  } | null;
  referenceTrack: AnalysisContext['currentTrack'] | null;
  allTracks: Array<{ name: string; lufsIntegrated: number; truePeakDbfs: number }>;
  normalizationSettings: { targetLufs: number; mode: string };
}
```

- This context is injected into the system prompt as a fenced JSON block.
- **No DOM access.** The agent cannot interact with the UI — it only reads data.

**Example prompts:**
- "Is my master loud enough for Spotify?"
- "Compare the dynamics of Track 3 vs the reference."
- "Which tracks are clipping?"

### 3.2 UI Interaction Mode

**Purpose:** Let the agent drive the app UI on the user's behalf.

**Context delivery:**
- The renderer serializes a DOM snapshot (simplified accessible tree, not raw HTML) and sends it to the main process.
- The agent can emit tool-use events for: `click(selector)`, `toggle(selector)`, `setValue(selector, value)`, `navigate(route)`.
- Each tool use requires approval (unless the user has selected "Allow All").

**Example prompts:**
- "Switch to the reference track."
- "Show me the spectrogram."
- "Toggle normalization off."
- "Play from the chorus marker."

**Security:** UI interaction mode tools are scoped to Producer Player's own DOM. The agent cannot open external URLs, access the filesystem directly, or execute arbitrary shell commands.

### 3.3 Mode Switching

- A toggle in the panel header: **"Analysis"** / **"UI Control"**.
- Defaults to Analysis. Switching to UI Control shows a one-time explainer tooltip: _"The agent can now interact with the app on your behalf. You'll be asked to approve each action."_
- Mode is included in the IPC `AGENT_START_SESSION` payload and can be changed mid-session.

---

## 4. Mastering Agent Behavior

### 4.1 Personality & Workflow

Detailed in `docs/AGENT_MASTERING_DESIGN.md` (to be created separately). The agent panel loads the system prompt defined there. Key traits:

- **Expert but approachable:** Explains mastering concepts without being condescending.
- **Data-driven:** Always references the actual analysis numbers, never guesses.
- **Opinionated when asked:** Has preferences on loudness targets, dynamic range, etc., but defers to the user's intent.
- **Non-destructive:** Never suggests actions that would modify audio files. All suggestions are about settings within Producer Player.

### 4.2 Default System Prompt (Summary)

```
You are a mastering-focused audio assistant embedded in Producer Player.
You have access to real-time audio analysis data for the currently loaded tracks.
When answering, reference specific measurements (LUFS, true peak, crest factor, etc.).
Format comparisons as tables when possible.
If the user asks you to do something in the app, switch to UI interaction mode.
```

### 4.3 Structured Analysis Output

When the agent performs a full-track analysis summary, it should use this format:

```markdown
## Track Analysis: {trackName}

| Metric | Value | Target Range | Status |
|--------|-------|-------------|--------|
| Integrated LUFS | -14.2 | -14 ± 1 | ✅ |
| True Peak | -0.8 dBFS | ≤ -1.0 | ⚠️ |
| Crest Factor | 8.2 dB | 6–12 | ✅ |
| Stereo Correlation | 0.72 | > 0.5 | ✅ |

### Observations
- ...
```

---

## 5. Voice Input (Deepgram)

### 5.1 Setup Flow

1. If no Deepgram API key is stored, the microphone button area shows a subtle inline prompt: _"Add Deepgram key for voice input"_ with a text field.
2. The key is stored in Electron's `safeStorage` (encrypted at rest).
3. Once set, the microphone button appears in the composer.

### 5.2 Recording Flow

1. User clicks the mic button (or holds the configured keyboard shortcut).
2. Visual feedback: pulsing red ring around the mic button, waveform amplitude indicator.
3. Audio is captured via the Web Audio API (`MediaRecorder`).
4. On release/click-stop, audio is sent to Deepgram's STT API.
5. Transcribed text populates the composer input.
6. User can review/edit, then send (or it auto-sends — configurable).

### 5.3 Keyboard Shortcut

- Default: Hold `Space` while the chat panel is focused (not when the text input is focused).
- Configurable via the three-dot settings menu.
- Hold-to-talk: recording starts on keydown, stops on keyup.

### 5.4 Settings Menu (three-dot icon in composer)

- **Deepgram API key:** masked input, edit/clear.
- **Keyboard shortcut:** rebindable hotkey field.
- **Auto-send after transcription:** toggle (default: off).
- **Hide voice input:** removes the mic button entirely for users who don't want it.
- **Language:** Deepgram language code (default: `en`).

---

## 6. UX Checklist

Comprehensive checklist of agent-in-app UX considerations. Each item should be addressed before shipping.

### Loading & Streaming States

- [ ] **Agent thinking indicator:** Animated dots or shimmer in the agent's message bubble while waiting for the first token.
- [ ] **Streaming text:** Tokens append in real-time with a blinking cursor at the end.
- [ ] **Tool execution spinner:** When the agent is running a tool, show a labeled spinner (e.g., "Analyzing spectrum...").
- [ ] **Approval pending state:** Distinct visual state when the agent is blocked waiting for user approval.
- [ ] **Reconnection indicator:** If the agent process dies and restarts, show a brief "Reconnecting..." banner.

### Error Handling

- [ ] **CLI not found:** Friendly message with install instructions and a link. "Claude CLI not found. Install it with `npm i -g @anthropic-ai/claude-code` and run `claude auth`."
- [ ] **Auth expired / invalid:** Prompt to re-authenticate. "Your Claude session has expired. Run `claude auth` in your terminal to refresh."
- [ ] **API rate limit:** Display retry countdown. "Rate limited. Retrying in 12s..."
- [ ] **Network failure:** Offline banner in the panel. Queued messages send when back online (or discard with notice).
- [ ] **Malformed agent response:** Gracefully render raw text if Markdown parsing fails.
- [ ] **Session crash:** Auto-restart the agent process, preserve chat history, notify the user.
- [ ] **Deepgram STT failure:** Fall back to text input with an error toast: "Voice transcription failed. Please type your message."

### Empty & First-Use States

- [ ] **No tracks loaded:** Agent panel shows: "Load some tracks first — I'll help you analyze them." with a button to link a folder.
- [ ] **First time opening panel:** Brief onboarding tooltip tour (3 steps max): what the agent can do, how to switch modes, voice input.
- [ ] **No provider configured:** Panel body shows provider setup instructions instead of the chat timeline.
- [ ] **Empty chat:** Suggested starter prompts as clickable chips: "How's my loudness?", "Compare to reference", "Check for clipping".

### Accessibility

- [ ] **Keyboard navigation:** `Tab` moves between composer, send button, and message list. `Arrow keys` navigate messages in the timeline.
- [ ] **Screen reader support:** Messages have `role="log"` with `aria-live="polite"`. New messages are announced. Approval banners use `role="alertdialog"`.
- [ ] **Focus management:** When the panel opens, focus moves to the composer. When an approval banner appears, focus moves to the banner.
- [ ] **High contrast:** Panel respects the OS high-contrast / reduced-motion preferences.
- [ ] **Minimum touch targets:** All interactive elements are at least 44x44px.

### Responsive Layout

- [ ] **Panel resize:** Minimum width 320px, minimum height 200px. Below minimums, panel collapses.
- [ ] **Panel collapse animation:** 200ms ease-out, no layout shift in the main app.
- [ ] **Window resize:** Panel maintains its proportional size (percentage-based) or snaps to minimum if the window gets too small.
- [ ] **Full-screen mode:** Panel can expand to fill the entire app window (useful for long analysis discussions).

### History & Persistence

- [ ] **Message history:** Conversations persist in a local SQLite table (or IndexedDB). Restored when the panel reopens.
- [ ] **Session continuity:** If the app restarts, the previous conversation is shown (read-only) with an option to continue or start fresh.
- [ ] **Clear chat:** Button in the panel header menu. Confirms before deleting.
- [ ] **Export chat:** Export as Markdown or plain text file via the panel header menu.

### Token Usage & Limits

- [ ] **Token counter:** Small, non-intrusive display at the bottom of the panel showing tokens used in the current session.
- [ ] **Cost estimate:** Optional display (can be hidden) showing estimated cost based on provider pricing.
- [ ] **Context window warning:** When the conversation is approaching the context limit, show a warning and suggest starting a new conversation.
- [ ] **Auto-summarize:** When context is nearly full, offer to summarize the conversation and start a new session with the summary as context.

### Message Actions

- [ ] **Copy message:** Button on hover/focus for each message. Copies raw Markdown.
- [ ] **Copy code block:** Dedicated copy button on each fenced code block.
- [ ] **Retry message:** Button to re-send the last user message (useful after errors).
- [ ] **Edit & resend:** Click on a sent user message to edit and re-send (forks the conversation).

### Generation Control

- [ ] **Stop button:** Replaces the send button while the agent is generating. Sends `AGENT_INTERRUPT`.
- [ ] **Stop confirmation:** No confirmation needed — stop is immediate and non-destructive.
- [ ] **Partial response:** When stopped, the partial response is kept in the timeline with a "(stopped)" label.

### Code & Rich Content Rendering

- [ ] **Syntax-highlighted code blocks:** Language auto-detection with manual override.
- [ ] **Inline charts / images:** Agent can return base64 images or chart specifications; rendered inline.
- [ ] **Collapsible tool-use details:** Tool inputs/outputs shown in a collapsible `<details>` block.
- [ ] **Tables:** Rendered as styled HTML tables, not raw Markdown pipes.

### Tool Approval UX

- [ ] **Per-action approval:** Default. Each tool use shows the approval banner.
- [ ] **Allow all (session):** User can choose "Allow All" — applies for the current session only. A persistent banner reminds them this is active.
- [ ] **Deny with reason:** Optional text field when denying, so the agent can adjust.
- [ ] **Approval timeout:** 60 seconds, then auto-deny. Configurable.
- [ ] **Approval history:** Scrollable log of past approvals/denials in the settings menu.

### Offline Behavior

- [ ] **Detection:** Monitor `navigator.onLine` and the agent process health.
- [ ] **Graceful degradation:** Panel remains open. User can read history. Composer shows "Offline — messages will send when reconnected" (or "Agent unavailable" if the CLI process died).
- [ ] **Queue or discard:** Queued messages are held for 5 minutes, then discarded with notice.

### Multi-Turn Context Management

- [ ] **Automatic context refresh:** Analysis data is re-injected on each turn so the agent always has current measurements (user may have switched tracks).
- [ ] **Context size display:** Show how much of the context window is used by system prompt + analysis data vs. conversation.
- [ ] **Conversation branching:** Not in v1, but the data model should support it (each message has a `parentId`).
- [ ] **System message injection:** The app can inject system messages (e.g., "User switched to Track 5") without user action.

### Security & Privacy

- [ ] **No data exfiltration:** The agent cannot send audio files, file paths, or user data to any endpoint other than the configured provider API.
- [ ] **API key storage:** Deepgram key stored via Electron `safeStorage`. Provider auth is managed by their respective CLIs.
- [ ] **Sandboxed tool execution:** UI interaction mode tools can only interact with Producer Player's own DOM.
- [ ] **Audit log:** All tool executions are logged locally (not sent anywhere) for user review.

---

## 7. Implementation Phases

### Phase A — Foundation

1. Add `AGENT_*` IPC channels to `@producer-player/contracts`.
2. Implement `AgentService` in `apps/electron/src/` with Claude SDK provider.
3. Build `AgentPanel` shell component: collapsible panel, composer, empty state.
4. Wire IPC: send message → receive streamed response → render in timeline.

### Phase B — Analysis Mode

1. Build `AnalysisContext` assembler in main process (reads from existing audio analysis).
2. Inject context into system prompt on each turn.
3. Implement Markdown rendering in message bubbles.
4. Add suggested starter prompts.

### Phase C — UI Interaction Mode

1. Implement DOM snapshot serializer in renderer.
2. Build tool-use execution bridge (click, toggle, setValue, navigate).
3. Implement approval banner and approval flow.
4. Add mode toggle in panel header.

### Phase D — Voice Input

1. Integrate Deepgram STT API.
2. Build mic button with recording UX.
3. Add keyboard shortcut (hold-to-talk).
4. Build settings menu (API key, shortcut, language).

### Phase E — Polish

1. Message history persistence.
2. Token usage display.
3. Export chat.
4. Accessibility audit and fixes.
5. Error handling for all edge cases in the checklist.
6. Optional Codex provider adapter.

---

## 8. Open Questions

1. **Context window budget:** How much of the context window should be reserved for analysis data vs. conversation history? Proposed: 30% analysis, 70% conversation.
2. **Conversation storage format:** SQLite table (consistent with existing app data) or IndexedDB (renderer-only, simpler)?
3. **Provider auto-detection:** Should the app auto-detect installed CLIs on startup, or only check when the user opens the panel?
4. **Multi-track analysis:** Should the agent receive analysis data for all loaded tracks, or only the currently selected one? (Proposed: current + reference, with ability to request others.)
5. **Streaming vs. batch for Deepgram:** Use Deepgram's streaming API for real-time transcription, or batch after recording stops? (Proposed: batch for v1, streaming for v2.)
