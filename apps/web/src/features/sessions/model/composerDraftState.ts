const COMPOSER_DRAFT_STORAGE_KEY = "cui:composer-draft:v1";
const COMPOSER_DRAFT_STATE_VERSION = 1;
const COMPOSER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ComposerMode = "chat" | "shell";

export type ComposerDraftState = {
  draft: string;
  mode: ComposerMode;
};

type StoredComposerDraftState = ComposerDraftState & {
  version: typeof COMPOSER_DRAFT_STATE_VERSION;
  updatedAt: number;
  expiresAt: number;
};

export function createEmptyComposerDraftState(): ComposerDraftState {
  return {
    draft: "",
    mode: "chat",
  };
}

export function loadComposerDraftState(): ComposerDraftState {
  const emptyState = createEmptyComposerDraftState();

  if (typeof window === "undefined") {
    return emptyState;
  }

  try {
    const rawState = window.localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY);

    if (!rawState) {
      return emptyState;
    }

    const parsed = JSON.parse(rawState) as Partial<StoredComposerDraftState>;

    if (
      parsed.version !== COMPOSER_DRAFT_STATE_VERSION ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() ||
      typeof parsed.draft !== "string"
    ) {
      window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
      return emptyState;
    }

    return {
      draft: parsed.draft,
      mode: parseComposerMode(parsed.mode),
    };
  } catch {
    window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    return emptyState;
  }
}

export function saveComposerDraftState(state: ComposerDraftState): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!state.draft) {
    clearComposerDraftState();
    return;
  }

  try {
    const now = Date.now();
    const storedState: StoredComposerDraftState = {
      draft: state.draft,
      mode: state.mode,
      version: COMPOSER_DRAFT_STATE_VERSION,
      updatedAt: now,
      expiresAt: now + COMPOSER_DRAFT_TTL_MS,
    };

    window.localStorage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(storedState));
  } catch {
    // Composer draft persistence is a convenience only; keep the composer usable.
  }
}

export function clearComposerDraftState(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures so private browsing or quota errors do not block chat.
  }
}

function parseComposerMode(value: unknown): ComposerMode {
  return value === "shell" ? "shell" : "chat";
}
