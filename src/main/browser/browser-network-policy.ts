import dns from "node:dns";
import { reverse } from "node:dns/promises";
import net from "node:net";
import type { Session } from "electron";
import type { BrowserNetworkIsolation, BrowserNavigationSettings } from "../../contract/browser.ts";
import { BrowserError } from "./browser-error.ts";

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);
const MAX_VIRTUAL_DNS_CACHE_ENTRIES = 512;

export interface BrowserResolvedEndpoint {
  address: string;
  family?: string | number;
}

export interface BrowserUrlPolicyOptions {
  resolveHost?: (hostname: string) => Promise<BrowserResolvedEndpoint[]>;
  resolveProxy?: (url: string) => Promise<string>;
  reverseHost?: (address: string) => Promise<string[]>;
  getDnsServers?: () => string[];
  strictNetworkAvailable?: boolean;
  now?: () => number;
}

export interface BrowserUrlCheckInput {
  settings: BrowserNavigationSettings;
  userApprovedPrivateNetwork?: boolean;
  userApprovedHttp?: boolean;
  deferDnsToBrowser?: boolean;
  allowProxyVirtualDns?: boolean;
  allowAboutBlank?: boolean;
}

export interface BrowserUrlCheckResult {
  url: string;
  protocol: "about:" | "http:" | "https:";
  hostname?: string;
  resolvedAddresses: string[];
  virtualDnsAddresses: string[];
  privateNetwork: boolean;
  isolation: BrowserNetworkIsolation;
}

export class BrowserNetworkPolicy {
  private readonly resolveHost?: BrowserUrlPolicyOptions["resolveHost"];
  private readonly resolveProxy?: BrowserUrlPolicyOptions["resolveProxy"];
  private readonly reverseHost?: BrowserUrlPolicyOptions["reverseHost"];
  private readonly getDnsServers?: BrowserUrlPolicyOptions["getDnsServers"];
  private readonly strictNetworkAvailable: boolean;
  private readonly now: () => number;
  private readonly virtualDnsCache = new Map<string, { confirmed: boolean; expiresAt: number }>();
  private readonly pendingVirtualDnsChecks = new Map<string, Promise<boolean>>();

  constructor(options: BrowserUrlPolicyOptions = {}) {
    this.resolveHost = options.resolveHost;
    this.resolveProxy = options.resolveProxy;
    this.reverseHost = options.reverseHost;
    this.getDnsServers = options.getDnsServers;
    this.strictNetworkAvailable = options.strictNetworkAvailable ?? false;
    this.now = options.now ?? Date.now;
  }

  async check(rawUrl: string, input: BrowserUrlCheckInput): Promise<BrowserUrlCheckResult> {
    if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 8_192 || /[\0\r\n]/.test(rawUrl)) {
      throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser URL is invalid");
    }
    if (rawUrl === "about:blank") {
      if (input.allowAboutBlank === false) {
        throw new BrowserError("NAVIGATION_BLOCKED", "about:blank is not allowed for this request");
      }
      return {
        url: rawUrl,
        protocol: "about:",
        resolvedAddresses: [],
        virtualDnsAddresses: [],
        privateNetwork: false,
        isolation: input.settings.networkIsolation,
      };
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser URL must be absolute");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BrowserError("UNSUPPORTED_PROTOCOL", `Browser protocol is not supported: ${url.protocol}`);
    }
    if (url.username || url.password) {
      throw new BrowserError("NAVIGATION_BLOCKED", "Browser URLs containing credentials are blocked");
    }
    if (url.protocol === "http:" && !input.settings.allowHttp && !input.userApprovedHttp) {
      throw new BrowserError("NAVIGATION_BLOCKED", "Plain HTTP navigation is disabled");
    }
    if (input.settings.networkIsolation === "strict" && !this.strictNetworkAvailable) {
      throw new BrowserError(
        "NETWORK_ISOLATION_UNAVAILABLE",
        "Strict Browser network isolation is selected but no enforcing network sandbox is available",
      );
    }

    const hostname = normalizeHostname(url.hostname);
    const literalIp = net.isIP(hostname) !== 0;
    const literalPrivate = isPrivateHostname(hostname) || isPrivateIpAddress(hostname);
    // For an address chosen by the user, Chromium can resolve through its configured proxy.
    const bestEffort = input.settings.networkIsolation === "best-effort";
    const deferDns = bestEffort && input.deferDnsToBrowser;
    const resolvedAddresses = literalIp ? [hostname] : deferDns ? [] : await this.resolve(hostname);
    const virtualDnsAddresses = literalIp
      ? []
      : await this.confirmVirtualDnsAddresses(
          url,
          resolvedAddresses,
          bestEffort && !literalPrivate && input.allowProxyVirtualDns === true,
        );
    const virtualDnsSet = new Set(virtualDnsAddresses);
    const resolvedPrivate = resolvedAddresses.some(
      (address) => isPrivateIpAddress(address) && !virtualDnsSet.has(address),
    );
    const privateNetwork = literalPrivate || resolvedPrivate;
    if (privateNetwork && !input.settings.allowPrivateNetwork && !input.userApprovedPrivateNetwork) {
      throw new BrowserError("PRIVATE_NETWORK_BLOCKED", "Navigation to a private or local network target is blocked", {
        details: { hostname },
      });
    }
    return {
      url: url.toString(),
      protocol: url.protocol,
      hostname,
      resolvedAddresses,
      virtualDnsAddresses,
      privateNetwork,
      isolation: input.settings.networkIsolation,
    };
  }

  private async resolve(hostname: string): Promise<string[]> {
    if (!this.resolveHost) return [];
    let endpoints: BrowserResolvedEndpoint[];
    try {
      endpoints = await this.resolveHost(hostname);
    } catch (error) {
      throw new BrowserError("NAVIGATION_BLOCKED", "Browser hostname resolution failed", {
        retryable: true,
        details: { hostname },
        cause: error,
      });
    }
    if (endpoints.length === 0) {
      throw new BrowserError("NAVIGATION_BLOCKED", "Browser hostname did not resolve", {
        retryable: true,
        details: { hostname },
      });
    }
    return [...new Set(endpoints.map((endpoint) => normalizeHostname(endpoint.address)))];
  }

  private async confirmVirtualDnsAddresses(url: URL, addresses: string[], allowProxy: boolean): Promise<string[]> {
    const candidates = addresses.filter(isBenchmarkingIpAddress);
    if (candidates.length === 0) return [];
    // Chromium's proxy can resolve virtual hostnames itself. Node's DNS
    // settings may differ from Chromium's and do not describe this route.
    if (allowProxy && (await this.isProxiedWithoutDirectFallback(url.href))) return candidates;
    if (!this.getDnsServers || !this.reverseHost) return [];
    let dnsServers: string[];
    try {
      dnsServers = this.getDnsServers();
    } catch {
      return [];
    }
    if (!dnsServers.some(isBenchmarkingIpAddress)) return [];
    const hostname = normalizeHostname(url.hostname);
    const checks = await Promise.all(
      candidates.map(async (address) => ({
        address,
        confirmed: await this.confirmVirtualDnsAddress(hostname, address),
      })),
    );
    return checks.filter(({ confirmed }) => confirmed).map(({ address }) => address);
  }

  private async isProxiedWithoutDirectFallback(url: string): Promise<boolean> {
    try {
      const route = await this.resolveProxy?.(url);
      const alternatives =
        route
          ?.split(";")
          .map((entry) => entry.trim())
          .filter(Boolean) ?? [];
      return alternatives.length > 0 && alternatives.every((entry) => /^(?:PROXY|HTTPS|SOCKS5)\s/i.test(entry));
    } catch {
      return false;
    }
  }

  private async confirmVirtualDnsAddress(hostname: string, address: string): Promise<boolean> {
    const key = `${hostname}\0${address}`;
    const cached = this.virtualDnsCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.confirmed;
    const pending = this.pendingVirtualDnsChecks.get(key);
    if (pending) return pending;

    const check = this.lookupVirtualDnsAddress(hostname, address)
      .then((confirmed) => {
        if (this.virtualDnsCache.size >= MAX_VIRTUAL_DNS_CACHE_ENTRIES) {
          const oldest = this.virtualDnsCache.keys().next().value as string | undefined;
          if (oldest) this.virtualDnsCache.delete(oldest);
        }
        this.virtualDnsCache.set(key, {
          confirmed,
          expiresAt: this.now() + (confirmed ? 30_000 : 5_000),
        });
        return confirmed;
      })
      .finally(() => this.pendingVirtualDnsChecks.delete(key));
    this.pendingVirtualDnsChecks.set(key, check);
    return check;
  }

  private async lookupVirtualDnsAddress(hostname: string, address: string): Promise<boolean> {
    try {
      const names = await withTimeout(this.reverseHost!(address), 1_500);
      return names?.some((name) => normalizeHostname(name) === hostname) === true;
    } catch {
      return false;
    }
  }
}

export function createSessionNetworkPolicyOptions(
  browserSession: Pick<Session, "resolveHost" | "resolveProxy">,
  options: Pick<BrowserUrlPolicyOptions, "strictNetworkAvailable" | "now"> = {},
): BrowserUrlPolicyOptions {
  return {
    ...options,
    resolveHost: async (hostname) => {
      const result = await browserSession.resolveHost(hostname);
      return result.endpoints.map((endpoint) => ({ address: endpoint.address, family: endpoint.family }));
    },
    resolveProxy: (url) => browserSession.resolveProxy(url),
    reverseHost: (address) => reverse(address),
    getDnsServers: () => dns.getServers(),
  };
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    PRIVATE_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family !== 6) return false;
  const lower = normalized.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateIpv4(mapped);
  return false;
}

export function isBenchmarkingIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (net.isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 198 && (b === 18 || b === 19);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    isBenchmarkingIpAddress(address) ||
    a >= 224
  );
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower.replace(/\.$/, "");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
