export function isEmbeddedAndroidApp(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

export function getAppPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  if (!isEmbeddedAndroidApp()) {
    return window.location.pathname;
  }

  const hashPath = window.location.hash.replace(/^#/, "");

  return hashPath.startsWith("/") ? hashPath : "/";
}

export function navigateApp(path: string, options: { replace?: boolean } = {}): void {
  const destination = isEmbeddedAndroidApp() ? `#${path}` : path;

  if (options.replace) {
    window.history.replaceState({}, "", destination);
  } else {
    window.history.pushState({}, "", destination);
  }
}
