/**
 * MicTranscribeButton — a small inline mic button used by text inputs
 * outside the agent-chat composer (e.g. the song / album checklist
 * "Add item" textarea, the in-place checklist item rename textarea).
 *
 * Visual + state language matches the agent-chat composer's mic button
 * (same SVG, same colour states — idle / arming / recording /
 * processing / error) so the affordance feels consistent across the
 * app. Wraps the `useMicTranscribe` hook to keep the audio flow + STT
 * call paths shared.
 */

import type { JSX } from 'react';
import {
  useMicTranscribe,
  type UseMicTranscribeOptions,
} from './useMicTranscribe';

export interface MicTranscribeButtonProps extends UseMicTranscribeOptions {
  /**
   * Test ID applied to the rendered <button> so tests can target it.
   * Default: `mic-transcribe-button`. Consumers should override with
   * something more specific (e.g. `song-checklist-mic-button`).
   */
  testId?: string;
  /**
   * Optional accessible label for the button. Default tooltip describes
   * the configured provider.
   */
  ariaLabel?: string;
  /**
   * Extra class names to apply alongside the base mic-button class.
   */
  className?: string;
}

const PROVIDER_DISPLAY: Record<'deepgram' | 'assemblyai', string> = {
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
};

export function MicTranscribeButton({
  onTranscript,
  onError,
  disabled = false,
  testId = 'mic-transcribe-button',
  ariaLabel,
  className = '',
}: MicTranscribeButtonProps): JSX.Element | null {
  const mic = useMicTranscribe({ onTranscript, onError, disabled });

  if (!mic.voiceSupported) return null;

  const providerName = PROVIDER_DISPLAY[mic.provider];

  const stateClass =
    mic.state === 'arming'
      ? 'agent-mic-button--arming'
      : mic.state === 'recording'
        ? 'agent-mic-button--recording'
        : mic.state === 'processing'
          ? 'agent-mic-button--processing'
          : mic.state === 'error'
            ? 'agent-mic-button--error'
            : '';

  const title =
    mic.state === 'arming'
      ? 'Opening microphone...'
      : mic.state === 'recording'
        ? `Stop recording (${providerName})`
        : mic.state === 'processing'
          ? `Transcribing with ${providerName}...`
          : `Record voice message (${providerName})`;

  const showSpinner = mic.state === 'arming' || mic.state === 'processing';

  return (
    <button
      type="button"
      className={[
        'agent-mic-button',
        'mic-transcribe-button',
        stateClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => void mic.toggle()}
      disabled={!mic.clickable}
      data-testid={testId}
      data-mic-state={mic.state}
      title={title}
      aria-label={ariaLabel ?? title}
    >
      {showSpinner ? (
        <div className="agent-mic-spinner" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  );
}
