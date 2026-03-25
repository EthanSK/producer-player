import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

interface AgentComposerProps {
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const MAX_ROWS = 6;
const MIN_ROWS = 1;

export function AgentComposer({
  onSend,
  onInterrupt,
  isStreaming,
  disabled = false,
}: AgentComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [hideVoice, setHideVoice] = useState(() => {
    return localStorage.getItem('producer-player.agent-hide-voice') === 'true';
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Check if Deepgram key exists
  useEffect(() => {
    void window.producerPlayer.agentGetDeepgramKey().then((key) => {
      setHasDeepgramKey(key !== null && key.length > 0);
    });
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * MAX_ROWS;
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    void onSend(trimmed);
    setText('');
  }, [text, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleMicToggle = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        // Transcribe with Deepgram
        const deepgramKey = await window.producerPlayer.agentGetDeepgramKey();
        if (!deepgramKey) {
          return;
        }

        try {
          const response = await fetch(
            'https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true',
            {
              method: 'POST',
              headers: {
                Authorization: `Token ${deepgramKey}`,
                'Content-Type': 'audio/webm',
              },
              body: audioBlob,
            }
          );

          if (!response.ok) {
            throw new Error(`Deepgram API error: ${response.status}`);
          }

          const result = await response.json();
          const transcript =
            result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

          if (transcript) {
            setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
            textareaRef.current?.focus();
          }
        } catch (err) {
          console.error('Voice transcription failed:', err);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [isRecording]);

  const canSend = text.trim().length > 0 && !isStreaming && !disabled;
  const showMic = hasDeepgramKey && !hideVoice;

  return (
    <div className="agent-composer" data-testid="agent-composer">
      <div className="agent-composer-input-row">
        <textarea
          ref={textareaRef}
          className="agent-composer-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Agent unavailable' : 'Ask about your master...'}
          disabled={disabled || isStreaming}
          rows={MIN_ROWS}
          data-testid="agent-composer-input"
        />
        <div className="agent-composer-buttons">
          {showMic && !isStreaming && (
            <button
              type="button"
              className={`agent-mic-button ${isRecording ? 'agent-mic-button--recording' : ''}`}
              onClick={() => void handleMicToggle()}
              data-testid="agent-mic-button"
              title={isRecording ? 'Stop recording' : 'Record voice message'}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
          {isStreaming ? (
            <button
              type="button"
              className="agent-stop-button"
              onClick={onInterrupt}
              data-testid="agent-stop-button"
              title="Stop generation"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="agent-send-button"
              onClick={handleSend}
              disabled={!canSend}
              data-testid="agent-send-button"
              title="Send message"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
