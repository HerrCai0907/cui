import { Folder } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { getWorkspacePathSuggestions } from "../api/codeApi";

export function WorkspacePathInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [result, setResult] = useState<{ path: string; suggestions: string[] } | null>(null);
  const suggestions = open && result?.path === value ? result.suggestions : [];
  const expanded = suggestions.length > 0;

  useEffect(() => {
    setResult(null);
    setActiveIndex(-1);

    if (!open || !value.trim()) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getWorkspacePathSuggestions(value, controller.signal)
        .then(({ suggestions }) => {
          if (!controller.signal.aborted) {
            setResult({ path: value, suggestions });
          }
        })
        .catch(() => {
          // Suggestions are optional; the workspace remains editable if lookup fails.
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, value]);

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function select(path: string) {
    setResult(null);
    setActiveIndex(-1);
    onChange(path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);

      if (expanded) {
        setActiveIndex((index) =>
          event.key === "ArrowDown"
            ? (index + 1) % suggestions.length
            : (index <= 0 ? suggestions.length : index) - 1,
        );
      }
      return;
    }

    if (expanded && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
      event.preventDefault();
      select(suggestions[Math.max(0, activeIndex)]!);
    }
  }

  return (
    <div className="workspace-path-input">
      <input
        value={value}
        aria-label="Workspace path"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={
          expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setActiveIndex(-1);
          setOpen(true);
          onChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <div className="workspace-path-dropdown">
          <ul id={listId} ref={listRef} role="listbox" aria-label="Workspace directories">
            {suggestions.map((path, index) => (
              <li
                key={path}
                id={`${listId}-${index}`}
                role="option"
                aria-label={path}
                aria-selected={index === activeIndex}
                title={path}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(path)}
              >
                <Folder size={16} aria-hidden="true" />
                <span className="workspace-path-label">
                  <span className="workspace-path-parent">
                    {path.slice(0, path.lastIndexOf("/", path.length - 2) + 1)}
                  </span>
                  <span className="workspace-path-name">
                    {path.slice(path.lastIndexOf("/", path.length - 2) + 1)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="workspace-path-hint">↑ ↓ to navigate · Tab or Enter to complete</div>
        </div>
      )}
    </div>
  );
}
