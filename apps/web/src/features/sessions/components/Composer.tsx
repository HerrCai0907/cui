import { Send, Square, Terminal } from "lucide-react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

type ComposerProps = {
  active: boolean;
  disabled: boolean;
  draft: string;
  shellMode: boolean;
  stopping: boolean;
  stopDisabled: boolean;
  lastEnterKeyDownRef: RefObject<number | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (draft: string) => void;
  onShellModeChange: (shellMode: boolean) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  active,
  disabled,
  draft,
  shellMode,
  stopping,
  stopDisabled,
  lastEnterKeyDownRef,
  textareaRef,
  onDraftChange,
  onShellModeChange,
  onStop,
  onSubmit,
}: ComposerProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      lastEnterKeyDownRef.current = null;
      return;
    }

    if (shellMode) {
      event.preventDefault();
      lastEnterKeyDownRef.current = null;

      if (!disabled && draft.trim()) {
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }

    const previousEnterKeyDown = lastEnterKeyDownRef.current;

    lastEnterKeyDownRef.current = event.timeStamp;

    if (
      previousEnterKeyDown !== null &&
      event.timeStamp - previousEnterKeyDown < 500 &&
      !disabled &&
      draft.trim()
    ) {
      event.preventDefault();
      lastEnterKeyDownRef.current = null;
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className={`composer ${shellMode ? "is-shell-mode" : ""}`} onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="message-input">
        {shellMode ? "Shell command" : "Message"}
      </label>
      <button
        className="composer-mode-button"
        type="button"
        aria-label={shellMode ? "Disable shell mode" : "Enable shell mode"}
        aria-pressed={shellMode}
        title={shellMode ? "Shell mode" : "Chat mode"}
        onClick={() => onShellModeChange(!shellMode)}
      >
        <Terminal size={18} />
      </button>
      <textarea
        id="message-input"
        ref={textareaRef}
        value={draft}
        placeholder={
          shellMode
            ? "Run a shell command..."
            : active
              ? "Continue this session..."
              : "Start with an initial prompt..."
        }
        rows={1}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer-actions">
        {stopping ? (
          <button
            className="send-button is-stop"
            type="button"
            aria-label="Stop generation"
            title="Stop"
            disabled={stopDisabled}
            onClick={onStop}
          >
            <Square size={17} fill="currentColor" />
            <span>Stop</span>
          </button>
        ) : null}
        <button
          className="send-button"
          type="submit"
          aria-label="Send message"
          title="Send"
          disabled={disabled}
        >
          <Send size={18} />
          <span>Send</span>
        </button>
      </div>
    </form>
  );
}
