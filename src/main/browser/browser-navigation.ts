import type { BrowserLoadFailure } from "../../contract/browser.ts";
import { BrowserError } from "./browser-error.ts";

export function normalizeAddress(value: string, allowLocalShorthand = false): string {
  if (typeof value !== "string") throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser address is invalid");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8_192 || /[\0\r\n]/.test(trimmed)) {
    throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser address is invalid");
  }
  if (allowLocalShorthand && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (trimmed === "about:blank" || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function navigationFailureError(error: unknown): BrowserError {
  if (error instanceof BrowserError && error.code === "NAVIGATION_FAILED") return error;
  const failure =
    error && typeof error === "object" && "errorDescription" in error ? (error as BrowserLoadFailure) : undefined;
  const source = error as { code?: unknown; errno?: unknown; message?: unknown };
  const netError =
    failure?.errorDescription ||
    (typeof source?.code === "string" ? source.code : "") ||
    (typeof source?.message === "string" ? source.message : "Navigation failed");
  const netErrorCode =
    failure?.errorCode ??
    (typeof source?.errno === "number" ? source.errno : typeof source?.code === "number" ? source.code : undefined);
  const permanentTls = /CERT_|SSL_|BLOCKED_BY_CLIENT|DISALLOWED_URL_SCHEME/i.test(netError);
  return new BrowserError("NAVIGATION_FAILED", "Browser navigation failed", {
    retryable: !permanentTls,
    recovery: permanentTls
      ? { reason: "unsupported", remediation: "ask-user" }
      : {
          reason: "transient-network",
          remediation: "wait-and-retry-once",
          retryAfterMs: 250,
        },
    details: {
      netError: netError.slice(0, 256),
      ...(netErrorCode === undefined ? {} : { netErrorCode }),
    },
    cause: error,
  });
}

export function popupLoadOptions(details: Electron.HandlerDetails): Electron.LoadURLOptions {
  const options: Electron.LoadURLOptions = {};
  if (details.referrer?.url) options.httpReferrer = details.referrer;
  if (details.postBody?.data?.length) {
    options.postData = details.postBody.data;
    const rawContentType = details.postBody.contentType;
    if (rawContentType && !/[\r\n]/.test(rawContentType)) {
      const boundary = details.postBody.boundary;
      const contentType =
        boundary && !/boundary=/i.test(rawContentType) && !/[\r\n]/.test(boundary)
          ? `${rawContentType}; boundary=${boundary}`
          : rawContentType;
      options.extraHeaders = `Content-Type: ${contentType}`;
    }
  }
  return options;
}
