import { ChevronDown, ChevronUp, FileCode, Loader2, SquareArrowOutUpRight, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { HighlightedCode } from "../../review/components/HighlightedCode";
import {
  getCodeRange,
  getSourceDefinition,
  type CodeRangeQuery,
  type CodeRangeResult,
} from "../api/codeApi";

type CodePreviewState =
  | {
      status: "idle";
    }
  | {
      status: "loading";
    }
  | {
      status: "ready";
      result: CodeRangeResult;
    }
  | {
      status: "error";
      message: string;
    };

type DefinitionLookupState =
  | {
      status: "idle";
    }
  | {
      status: "loading";
    }
  | {
      status: "ready";
      target: CodeLocationTarget;
    }
  | {
      status: "error";
      message: string;
    };

type CodeCardOffset = {
  x: number;
  y: number;
};

type CodeCardDragState = {
  pointerId: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
};

type CodeCardPointerDownState = {
  at: number;
  x: number;
  y: number;
};

type SourceDefinitionMenuState = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
};

const SOURCE_DEFINITION_MENU_DELAY_MS = 1000;
const SOURCE_DEFINITION_MENU_HIDE_DELAY_MS = 1000;

export type CodeLocationTarget = CodeRangeQuery;

export function CodePreviewButton({
  label,
  target,
  workspace,
}: {
  label: string;
  target: CodeLocationTarget;
  workspace: string;
}) {
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);

  useCloseOnOutsidePointerDown(open, previewRef, () => setOpen(false));

  return (
    <span className="message-code-preview" ref={previewRef}>
      <button
        className="message-code-link"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title={target.filePath}
      >
        <FileCode size={14} />
        {label}
      </button>
      {open && (
        <FloatingCodePreview
          key={formatCodePathForClipboard(target)}
          target={target}
          workspace={workspace}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

export function SourceDefinitionNavigator({
  children,
  className,
  filePath,
  startLine,
  workspace,
}: {
  children: ReactNode;
  className?: string;
  filePath: string;
  startLine: number;
  workspace?: string;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const hoverPointRef = useRef<SourceDefinitionMenuState | undefined>(undefined);
  const [lookup, setLookup] = useState<DefinitionLookupState>({ status: "idle" });
  const [menu, setMenu] = useState<SourceDefinitionMenuState | undefined>(undefined);

  useCloseOnOutsidePointerDown(
    Boolean(menu) || lookup.status === "ready" || lookup.status === "error",
    containerRef,
    () => closeDefinitionOverlays(),
  );

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearHideTimer();
    };
  }, []);

  function closeDefinitionOverlays() {
    clearHoverTimer();
    clearHideTimer();
    setMenu(undefined);
    setLookup({ status: "idle" });
  }

  function scheduleDefinitionMenu(event: ReactPointerEvent<HTMLElement>) {
    if (!workspace || event.pointerType === "touch") {
      return;
    }

    clearHideTimer();

    if (event.target instanceof Element && event.target.closest(".source-definition-menu")) {
      return;
    }

    const nextMenu = readSourceDefinitionMenuState(
      containerRef.current,
      event.clientX,
      event.clientY,
    );

    if (!nextMenu) {
      clearHoverTimer();
      setMenu(undefined);
      return;
    }

    if (lookup.status === "error") {
      setLookup({ status: "idle" });
    }

    hoverPointRef.current = nextMenu;
    clearHoverTimer();

    hoverTimerRef.current = window.setTimeout(() => {
      setMenu(hoverPointRef.current);
      hoverTimerRef.current = undefined;
    }, SOURCE_DEFINITION_MENU_DELAY_MS);
  }

  function clearHoverTimer() {
    if (hoverTimerRef.current === undefined) {
      return;
    }

    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = undefined;
  }

  function clearHideTimer() {
    if (hideTimerRef.current === undefined) {
      return;
    }

    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
  }

  function scheduleHideDefinitionMenu() {
    clearHoverTimer();
    clearHideTimer();

    hideTimerRef.current = window.setTimeout(() => {
      hoverPointRef.current = undefined;
      setMenu(undefined);
      hideTimerRef.current = undefined;
    }, SOURCE_DEFINITION_MENU_HIDE_DELAY_MS);
  }

  async function openDefinitionFromMenu() {
    if (!workspace) {
      return;
    }

    const hoverPoint = menu ?? hoverPointRef.current;

    if (!hoverPoint) {
      setLookup({ status: "error", message: "Hover over a symbol first" });
      return;
    }

    const position = readSelectedCodePosition(
      containerRef.current,
      startLine,
      hoverPoint.clientX,
      hoverPoint.clientY,
    );

    if (!position) {
      setLookup({ status: "error", message: "Hover over a symbol first" });
      return;
    }

    setMenu(undefined);
    setLookup({ status: "loading" });

    try {
      const definition = await getSourceDefinition({
        workspace,
        filePath,
        line: position.line,
        character: position.character,
      });

      if (!definition.found || !definition.target) {
        setLookup({ status: "error", message: "Definition not found" });
        return;
      }

      setLookup({
        status: "ready",
        target: {
          filePath: definition.target.filePath,
          startLine: definition.target.startLine,
          endLine: definition.target.endLine,
        },
      });
    } catch (error) {
      setLookup({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to find definition",
      });
    }
  }

  return (
    <span
      className={sourceDefinitionTargetClassName(className)}
      ref={containerRef}
      onPointerEnter={clearHideTimer}
      onPointerMove={scheduleDefinitionMenu}
      onPointerLeave={scheduleHideDefinitionMenu}
    >
      {children}
      {menu && lookup.status !== "loading" && lookup.status !== "ready" && (
        <span className="source-definition-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            className="source-definition-menu-item"
            type="button"
            role="menuitem"
            onClick={() => void openDefinitionFromMenu()}
          >
            <SquareArrowOutUpRight size={14} />
            Jump to definition
          </button>
        </span>
      )}
      {lookup.status === "loading" && (
        <span className="message-code-card source-definition-status" role="status">
          <span className="message-code-card-status">
            <Loader2 size={14} />
            Loading
          </span>
        </span>
      )}
      {lookup.status === "error" && (
        <span className="message-code-card source-definition-status" role="status">
          <span className="message-code-card-error">{lookup.message}</span>
        </span>
      )}
      {lookup.status === "ready" && workspace && (
        <FloatingCodePreview
          key={formatCodePathForClipboard(lookup.target)}
          target={lookup.target}
          workspace={workspace}
          onClose={() => setLookup({ status: "idle" })}
        />
      )}
    </span>
  );
}

function FloatingCodePreview({
  onClose,
  target,
  workspace,
}: {
  onClose: () => void;
  target: CodeLocationTarget;
  workspace: string;
}) {
  const dragStateRef = useRef<CodeCardDragState | null>(null);
  const lastHeaderPointerDownRef = useRef<CodeCardPointerDownState | undefined>(undefined);
  const copyFeedbackTimerRef = useRef<number | undefined>(undefined);
  const [preview, setPreview] = useState<CodePreviewState>({ status: "idle" });
  const [query, setQuery] = useState<CodeLocationTarget>(() => getInitialCodePreviewQuery(target));
  const [cardOffset, setCardOffset] = useState<CodeCardOffset>({ x: 0, y: 0 });
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);

  useEffect(() => {
    void loadPreview(getInitialCodePreviewQuery(target));
  }, [target]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  async function loadPreview(nextQuery: CodeLocationTarget) {
    setQuery(nextQuery);
    setPreview({ status: "loading" });

    try {
      const result = await getCodeRange(nextQuery);
      setPreview({ status: "ready", result });
    } catch (error) {
      setPreview({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load code",
      });
    }
  }

  function expandBackward() {
    if (preview.status !== "ready") {
      return;
    }

    void loadPreview({
      filePath: preview.result.filePath,
      startLine: Math.max(1, preview.result.startLine - 10),
      endLine: preview.result.endLine,
    });
  }

  function expandForward() {
    if (preview.status !== "ready") {
      return;
    }

    void loadPreview({
      filePath: preview.result.filePath,
      startLine: preview.result.startLine,
      endLine: preview.result.endLine + 10,
    });
  }

  async function copyCodePath(targetElement: EventTarget) {
    if (isInteractiveDragTarget(targetElement) || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(formatCodePathForClipboard(query));
    setPathCopied(true);

    if (copyFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setPathCopied(false);
      copyFeedbackTimerRef.current = undefined;
    }, 1200);
  }

  function startCardDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
      return;
    }

    const previousPointerDown = lastHeaderPointerDownRef.current;
    const isDoublePointerDown =
      previousPointerDown !== undefined &&
      window.performance.now() - previousPointerDown.at <= 500 &&
      Math.abs(event.clientX - previousPointerDown.x) <= 6 &&
      Math.abs(event.clientY - previousPointerDown.y) <= 6;

    if (event.detail >= 2 || isDoublePointerDown) {
      lastHeaderPointerDownRef.current = undefined;
      void copyCodePath(event.target);
      event.preventDefault();
      return;
    }

    lastHeaderPointerDownRef.current = {
      at: window.performance.now(),
      x: event.clientX,
      y: event.clientY,
    };
    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: cardOffset.x,
      offsetY: cardOffset.y,
    };
    setIsDraggingCard(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dragCard(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setCardOffset({
      x: dragState.offsetX + event.clientX - dragState.originX,
      y: dragState.offsetY + event.clientY - dragState.originY,
    });
  }

  function stopCardDrag(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setIsDraggingCard(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const hasRange = query.startLine !== undefined && query.endLine !== undefined;

  return (
    <span
      className={`message-code-card${isDraggingCard ? " is-dragging" : ""}`}
      role="dialog"
      aria-label="Code preview"
      style={{ transform: `translate3d(${cardOffset.x}px, ${cardOffset.y}px, 0)` }}
    >
      <span
        className="message-code-card-header"
        onPointerDown={startCardDrag}
        onPointerMove={dragCard}
        onPointerUp={stopCardDrag}
        onPointerCancel={stopCardDrag}
        onDoubleClick={(event) => void copyCodePath(event.target)}
        title="Double-click to copy code path"
      >
        <span className="message-code-card-title">
          {target.filePath}
          {hasRange
            ? `:${query.startLine}${query.startLine === query.endLine ? "" : `-${query.endLine}`}`
            : ""}
        </span>
        {pathCopied && <span className="message-code-card-copy-status">Copied</span>}
        <button
          className="message-code-card-close"
          type="button"
          aria-label="Close code preview"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </span>
      {preview.status === "loading" && (
        <span className="message-code-card-status">
          <Loader2 size={14} />
          Loading
        </span>
      )}
      {preview.status === "error" && (
        <span className="message-code-card-error">{preview.message}</span>
      )}
      {preview.status === "ready" && (
        <span className="message-code-card-block">
          <span className="message-code-card-code-stack">
            {hasRange && (
              <button
                className="message-code-card-line-action"
                type="button"
                onClick={expandBackward}
                disabled={preview.result.startLine <= 1}
                title="Show 10 previous lines"
                aria-label="Show 10 previous lines"
              >
                <ChevronUp size={14} />
                <span className="message-code-card-line-range">
                  Lines {preview.result.startLine}-{preview.result.endLine}
                </span>
              </button>
            )}
            <code>
              <SourceDefinitionNavigator
                filePath={preview.result.filePath}
                startLine={preview.result.startLine}
                workspace={workspace}
              >
                <HighlightedCode content={preview.result.code} filePath={preview.result.filePath} />
              </SourceDefinitionNavigator>
            </code>
            {hasRange && (
              <button
                className="message-code-card-line-action"
                type="button"
                onClick={expandForward}
                title="Show 10 next lines"
                aria-label="Show 10 next lines"
              >
                <ChevronDown size={14} />
                <span className="message-code-card-line-range">
                  Lines {preview.result.startLine}-{preview.result.endLine}
                </span>
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

function useCloseOnOutsidePointerDown(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || ref.current?.contains(event.target)) {
        return;
      }

      onClose();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [onClose, open, ref]);
}

function readSelectedCodePosition(
  container: HTMLElement | null,
  startLine: number,
  clientX?: number,
  clientY?: number,
): { line: number; character: number } | undefined {
  if (!container) {
    return undefined;
  }

  const pointerPosition =
    clientX === undefined || clientY === undefined
      ? undefined
      : readCodePositionFromPoint(container, startLine, clientX, clientY);

  if (pointerPosition) {
    return pointerPosition;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);

  if (!container.contains(range.startContainer)) {
    return undefined;
  }

  return readCodePositionFromRangeBoundary(
    container,
    startLine,
    range.startContainer,
    range.startOffset,
  );
}

function readCodePositionFromPoint(
  container: HTMLElement,
  startLine: number,
  clientX: number,
  clientY: number,
): { line: number; character: number } | undefined {
  const range = getCaretRangeFromPoint(clientX, clientY);

  if (!range || !container.contains(range.startContainer)) {
    return undefined;
  }

  return readCodePositionFromRangeBoundary(
    container,
    startLine,
    range.startContainer,
    range.startOffset,
  );
}

function readCodePositionFromRangeBoundary(
  container: HTMLElement,
  startLine: number,
  node: Node,
  offset: number,
): { line: number; character: number } | undefined {
  const prefixRange = document.createRange();

  try {
    prefixRange.setStart(container, 0);
    prefixRange.setEnd(node, offset);
  } catch {
    return undefined;
  }

  const prefix = prefixRange.toString();
  const lines = prefix.split("\n");

  return {
    line: startLine + lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}

function getCaretRangeFromPoint(clientX: number, clientY: number): Range | undefined {
  const documentWithCaretApi = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = documentWithCaretApi.caretPositionFromPoint?.(clientX, clientY);

  if (caretPosition) {
    const range = document.createRange();

    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);

    return range;
  }

  return documentWithCaretApi.caretRangeFromPoint?.(clientX, clientY) ?? undefined;
}

function readSourceDefinitionMenuState(
  container: HTMLElement | null,
  clientX: number,
  clientY: number,
): SourceDefinitionMenuState | undefined {
  if (!container) {
    return undefined;
  }

  const range = getCaretRangeFromPoint(clientX, clientY);

  if (!range || !container.contains(range.startContainer)) {
    return undefined;
  }

  const bounds = container.getBoundingClientRect();

  return {
    x: Math.max(0, clientX - bounds.left),
    y: Math.max(0, clientY - bounds.top + 18),
    clientX,
    clientY,
  };
}

function sourceDefinitionTargetClassName(className: string | undefined): string {
  if (!className) {
    return "source-definition-target";
  }

  return className.split(/\s+/).includes("source-definition-target")
    ? className
    : `source-definition-target ${className}`;
}

function isInteractiveDragTarget(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select"));
}

function getInitialCodePreviewQuery(target: CodeLocationTarget): CodeLocationTarget {
  if (
    target.startLine !== undefined &&
    target.endLine !== undefined &&
    target.startLine === target.endLine
  ) {
    return {
      filePath: target.filePath,
      startLine: target.startLine,
      endLine: target.endLine + 10,
    };
  }

  return target;
}

function formatCodePathForClipboard(target: CodeLocationTarget): string {
  if (target.startLine === undefined) {
    return target.filePath;
  }

  return `${target.filePath}:${target.startLine}`;
}
