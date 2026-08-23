const REVIEW_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_STATE_VERSION = 1;

export type AtomicReviewItemState = {
  collapsed?: boolean;
  approvedFileIds: string[];
};

export type ReviewBrowserState = {
  fullApprovedFileIds: string[];
  atomicItems: Record<string, AtomicReviewItemState>;
};

type StoredReviewBrowserState = ReviewBrowserState & {
  version: typeof REVIEW_STATE_VERSION;
  updatedAt: number;
  expiresAt: number;
};

export function createEmptyReviewBrowserState(): ReviewBrowserState {
  return {
    fullApprovedFileIds: [],
    atomicItems: {},
  };
}

export function createEmptyAtomicItemState(): AtomicReviewItemState {
  return {
    approvedFileIds: [],
  };
}

export function loadReviewBrowserState(stateKey: string): ReviewBrowserState {
  const emptyState = createEmptyReviewBrowserState();

  try {
    const rawState = window.localStorage.getItem(stateKey);

    if (!rawState) {
      return emptyState;
    }

    const parsed = JSON.parse(rawState) as Partial<StoredReviewBrowserState>;

    if (
      parsed.version !== REVIEW_STATE_VERSION ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(stateKey);
      return emptyState;
    }

    return {
      fullApprovedFileIds: parseStringList(parsed.fullApprovedFileIds),
      atomicItems: parseAtomicItemStates(parsed.atomicItems),
    };
  } catch {
    window.localStorage.removeItem(stateKey);
    return emptyState;
  }
}

export function saveReviewBrowserState(stateKey: string, state: ReviewBrowserState) {
  try {
    const now = Date.now();
    const storedState: StoredReviewBrowserState = {
      ...state,
      version: REVIEW_STATE_VERSION,
      updatedAt: now,
      expiresAt: now + REVIEW_STATE_TTL_MS,
    };

    window.localStorage.setItem(stateKey, JSON.stringify(storedState));
  } catch {
    // Local persistence is a convenience only; keep the review UI usable.
  }
}

export function toggleString(values: string[], value: string, included: boolean): string[] {
  const next = new Set(values);

  if (included) {
    next.add(value);
  } else {
    next.delete(value);
  }

  return [...next];
}

function parseAtomicItemStates(value: unknown): Record<string, AtomicReviewItemState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, AtomicReviewItemState>>(
    (states, [itemId, itemState]) => {
      if (!itemState || typeof itemState !== "object" || Array.isArray(itemState)) {
        return states;
      }

      const candidate = itemState as Partial<AtomicReviewItemState>;

      states[itemId] = {
        collapsed: typeof candidate.collapsed === "boolean" ? candidate.collapsed : undefined,
        approvedFileIds: parseStringList(candidate.approvedFileIds),
      };

      return states;
    },
    {},
  );
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
