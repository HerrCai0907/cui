import { Send, Square } from "lucide-react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

type ComposerProps = {
  active: boolean;
  disabled: boolean;
  draft: string;
  stopping: boolean;
  stopDisabled: boolean;
  lastEnterKeyDownRef: RefObject<number | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (draft: string) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  active,
  disabled,
  draft,
  stopping,
  stopDisabled,
  lastEnterKeyDownRef,
  textareaRef,
  onDraftChange,
  onStop,
  onSubmit,
}: ComposerProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      lastEnterKeyDownRef.current = null;
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
    <form className="composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <textarea
        id="message-input"
        ref={textareaRef}
        value={draft}
        placeholder={active ? "Continue this session..." : "Start with an initial prompt..."}
        rows={1}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        className={`send-button ${stopping ? "is-stop" : ""}`}
        type={stopping ? "button" : "submit"}
        aria-label={stopping ? "Stop generation" : "Send message"}
        title={stopping ? "Stop" : "Send"}
        disabled={stopping ? stopDisabled : disabled}
        onClick={stopping ? onStop : undefined}
      >
        {stopping ? <Square size={17} fill="currentColor" /> : <Send size={18} />}
        <span>{stopping ? "Stop" : "Send"}</span>
      </button>
    </form>
  );
}
