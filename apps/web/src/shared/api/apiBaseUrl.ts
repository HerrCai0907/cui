export const API_BASE_URL_STORAGE_KEY = "cui:api-base-url:v1";

type AndroidBridge = {
  getApiBaseUrl?: () => string;
};

export function getDefaultApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.protocol === "file:") {
    return normalizeBridgeApiBaseUrl(getAndroidBridge().getApiBaseUrl?.());
  }

  return "";
}

export function loadApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return getDefaultApiBaseUrl();
  }

  if (window.location?.protocol === "file:") {
    return getDefaultApiBaseUrl();
  }

  try {
    const stored = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);

    if (stored === null) {
      return getDefaultApiBaseUrl();
    }

    return normalizeApiBaseUrl(stored);
  } catch {
    return getDefaultApiBaseUrl();
  }
}

export function saveApiBaseUrl(baseUrl: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalizeApiBaseUrl(baseUrl));
  } catch {
    // API server persistence is a convenience; requests can still use the current value.
  }
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("API server must use http:// or https://");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API server must use http:// or https://");
  }

  parsed.hash = "";
  parsed.search = "";

  return parsed.toString().replace(/\/$/, "");
}

export function resolveApiUrl(path: string, baseUrl = loadApiBaseUrl()): string {
  if (/^https?:\/\//i.test(path) || !baseUrl) {
    return path;
  }

  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
  const relativePath = path.startsWith("/") ? path.slice(1) : path;

  return `${normalizedBaseUrl}/${relativePath}`;
}

function getAndroidBridge(): AndroidBridge {
  return typeof window === "undefined"
    ? {}
    : ((window as Window & { CuiAndroid?: AndroidBridge }).CuiAndroid ?? {});
}

function normalizeBridgeApiBaseUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    return normalizeApiBaseUrl(value);
  } catch {
    return "";
  }
}
