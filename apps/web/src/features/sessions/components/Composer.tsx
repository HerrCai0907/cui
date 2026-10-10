import { Check, ChevronRight, Cpu, Send, Square, Terminal } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  REASONING_EFFORT_LABELS,
  createVisibleReasoningEffortOptions,
  findModelOption,
  type ModelOption,
  type ReasoningEffort,
} from "../../config/model/appConfig";

type ComposerProps = {
  active: boolean;
  disabled: boolean;
  draft: string;
  modelOptions: ModelOption[];
  modelsError?: string | null;
  selectedModel: string;
  selectedReasoningEffort: ReasoningEffort;
  shellMode: boolean;
  stopping: boolean;
  stopDisabled: boolean;
  lastEnterKeyDownRef: RefObject<number | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (draft: string) => void;
  onModelSelectionChange: (model: string, reasoningEffort: ReasoningEffort) => void;
  onShellModeChange: (shellMode: boolean) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  active,
  disabled,
  draft,
  modelOptions,
  modelsError,
  selectedModel,
  selectedReasoningEffort,
  shellMode,
  stopping,
  stopDisabled,
  lastEnterKeyDownRef,
  textareaRef,
  onDraftChange,
  onModelSelectionChange,
  onShellModeChange,
  onStop,
  onSubmit,
}: ComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState(selectedModel);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelChoices = useMemo(
    () => [
      { name: "", label: "Harness default" },
      ...modelOptions.map((model) => ({
        name: model.name,
        label: model.name,
      })),
    ],
    [modelOptions],
  );
  const reasoningOptions = createVisibleReasoningEffortOptions(pendingModel, modelOptions);
  const selectedModelLabel = selectedModel || "Harness default";
  const modelButtonTitle = `${selectedModelLabel} / ${REASONING_EFFORT_LABELS[selectedReasoningEffort]}`;

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }

    setPendingModel(selectedModel);
  }, [modelMenuOpen, selectedModel]);

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setModelMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelMenuOpen]);

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

  function selectModel(model: string) {
    setPendingModel(model);
  }

  function selectReasoningEffort(reasoningEffort: ReasoningEffort) {
    onModelSelectionChange(pendingModel, reasoningEffort);
    setModelMenuOpen(false);
  }

  function getModelDefaultReasoningEffort(model: string): ReasoningEffort {
    const options = createVisibleReasoningEffortOptions(model, modelOptions);
    const selectedModelOption = findModelOption(model, modelOptions);

    if (
      selectedModelOption?.defaultReasoningEffort &&
      options.includes(selectedModelOption.defaultReasoningEffort)
    ) {
      return selectedModelOption.defaultReasoningEffort;
    }

    return options[0] ?? selectedReasoningEffort;
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
        <span className="composer-control-label">{shellMode ? "Chat" : "Shell"}</span>
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
            className="send-button composer-send-button is-stop"
            type="button"
            aria-label="Stop generation"
            title="Stop"
            disabled={stopDisabled}
            onClick={onStop}
          >
            <Square size={17} fill="currentColor" />
            <span className="composer-control-label">Stop</span>
          </button>
        ) : null}
        <button
          className="send-button composer-send-button"
          type="submit"
          aria-label="Send message"
          title="Send"
          disabled={disabled}
        >
          <Send size={18} />
          <span className="composer-control-label">Send</span>
        </button>
      </div>
      <div className="composer-model-menu" ref={modelMenuRef}>
        <button
          className="composer-model-button"
          type="button"
          aria-label="Select model and reasoning effort"
          aria-expanded={modelMenuOpen}
          title={modelButtonTitle}
          onClick={() => setModelMenuOpen((open) => !open)}
        >
          <Cpu size={18} />
          <span className="composer-control-label">Model</span>
        </button>
        {modelMenuOpen && (
          <div className="composer-model-popover" role="menu" aria-label="Model and reasoning">
            <div className="composer-model-column" role="group" aria-label="Models">
              {modelChoices.map((model) => {
                const active = model.name === pendingModel;
                const selected = model.name === selectedModel;

                return (
                  <button
                    className={`composer-model-menu-item ${active ? "is-active" : ""}`}
                    type="button"
                    role="menuitem"
                    key={model.name || "default"}
                    aria-checked={active}
                    onMouseEnter={() => selectModel(model.name)}
                    onFocus={() => selectModel(model.name)}
                    onClick={() => selectModel(model.name)}
                  >
                    <span>{model.label}</span>
                    {selected ? <Check size={14} /> : <ChevronRight size={14} />}
                  </button>
                );
              })}
            </div>
            <div className="composer-model-column" role="group" aria-label="Reasoning efforts">
              {reasoningOptions.map((reasoningEffort) => {
                const selected =
                  pendingModel === selectedModel && reasoningEffort === selectedReasoningEffort;

                return (
                  <button
                    className={`composer-model-menu-item ${selected ? "is-active" : ""}`}
                    type="button"
                    role="menuitem"
                    key={reasoningEffort}
                    onClick={() => selectReasoningEffort(reasoningEffort)}
                  >
                    <span>{REASONING_EFFORT_LABELS[reasoningEffort]}</span>
                    {selected ? <Check size={14} /> : null}
                  </button>
                );
              })}
              <button
                className="composer-model-menu-item is-muted"
                type="button"
                role="menuitem"
                onClick={() => selectReasoningEffort(getModelDefaultReasoningEffort(pendingModel))}
              >
                <span>Model default</span>
              </button>
            </div>
            {modelsError && <p className="composer-model-error">{modelsError}</p>}
          </div>
        )}
      </div>
    </form>
  );
}
