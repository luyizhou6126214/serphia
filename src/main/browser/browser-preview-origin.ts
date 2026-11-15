const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function loopbackPreviewOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** WebSocket requests from the preview document use the same origin as HTTP assets. */
export function previewRequestUrl(url: string, origin: string | undefined): string | null {
  if (!origin) return null;
  const httpUrl = url.replace(/^ws(s?):/i, "http$1:");
  return loopbackPreviewOrigin(httpUrl) === origin ? httpUrl : null;
}
