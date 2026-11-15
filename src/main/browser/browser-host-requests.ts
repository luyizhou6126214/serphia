import { createHmac } from "node:crypto";
import type { BrowserHostMethod } from "../../contract/browser.ts";
import { appendMainLog } from "../logger.ts";

export function requiredPermission(method: BrowserHostMethod): "read" | "interact" | "advanced" {
  if (
    method === "browser.click" ||
    method === "browser.clickAt" ||
    method === "browser.type" ||
    method === "browser.press" ||
    method === "browser.scroll"
  ) {
    return "interact";
  }
  if (
    method === "browser.executeJavaScript" ||
    method === "browser.getCookies" ||
    method === "browser.setCookies" ||
    method === "browser.setRequestHeaderRules" ||
    method === "browser.setResponseHeaderRules" ||
    method === "browser.sendCdpCommand" ||
    method === "browser.networkList" ||
    method === "browser.networkWait" ||
    method === "browser.networkBody" ||
    method === "browser.networkReplay" ||
    method === "browser.networkSummary" ||
    method === "browser.consoleList" ||
    method === "browser.consoleWait" ||
    method === "browser.pageCodeList" ||
    method === "browser.pageCodeGet"
  ) {
    return "advanced";
  }
  return "read";
}

export function auditBrowserHostRequest(
  auditKey: Buffer,
  method: BrowserHostMethod,
  params: unknown,
  outcome: string,
): void {
  const body = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const session = opaqueAuditId(auditKey, body.sessionId);
  const tab = opaqueAuditId(auditKey, body.tabId);
  let origin = "none";
  if (typeof body.url === "string") {
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") origin = parsed.origin.slice(0, 512);
    } catch {
      // Invalid URLs are represented by the result code without logging input.
    }
  }
  const revision = Number.isSafeInteger(body.policyRevision) ? String(body.policyRevision) : "none";
  const digest = createHmac("sha256", auditKey).update(redactedAuditShape(params)).digest("hex").slice(0, 16);
  appendMainLog(
    `[browser] method=${method} session=${session} tab=${tab} origin=${origin} outcome=${outcome} revision=${revision} input=${digest}`,
  );
}

function opaqueAuditId(key: Buffer, value: unknown): string {
  if (typeof value !== "string" || !value) return "none";
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
}

function redactedAuditShape(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (field, entry: unknown) => {
        if (field === "sessionId" || field === "tabId" || field === "capabilityLeaseId" || field === "requestId") {
          return `<${field}>`;
        }
        if (typeof entry === "bigint") return `<bigint:${entry.toString().length}>`;
        if (entry && typeof entry === "object") {
          if (seen.has(entry)) return "<circular>";
          seen.add(entry);
        }
        return entry;
      }) ?? "undefined"
    );
  } catch {
    return "unserializable";
  }
}
