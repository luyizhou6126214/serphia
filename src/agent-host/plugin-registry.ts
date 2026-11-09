/**
 * Pi package discovery through the npm registry.
 *
 * This is the same upstream source `pi install` uses, so search, installation,
 * and registry mirrors stay consistent: results come from npm's search index on
 * the `pi-package` keyword, and resource types come from each package's own
 * published manifest (`pi.extensions` / `skills` / `prompts` / `themes`).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RpcError } from "../contract/types.ts";
import type { PluginPackageType, PluginSearchResponse, PluginSearchResult } from "../shared/api-types";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const PAGE_SIZE = 50;
const CACHE_TTL_MS = 5 * 60_000;
const TYPE_CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX_ENTRIES = 64;
const MAX_QUERY_LENGTH = 120;
const REQUEST_TIMEOUT_MS = 8_000;
const TYPE_TIMEOUT_MS = 3_500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TYPE_CONCURRENCY = 10;
const MAX_TYPE_NAMES = 50;
const PI_PACKAGE_KEYWORD = "pi-package";
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

const TYPE_MANIFEST_KEYS: ReadonlyArray<readonly [PluginPackageType, string]> = [
  ["extension", "extensions"],
  ["skill", "skills"],
  ["prompt", "prompts"],
  ["theme", "themes"],
];

const TYPE_KEYWORDS: ReadonlyArray<readonly [PluginPackageType, string]> = [
  ["extension", "pi-extension"],
  ["skill", "pi-skill"],
  ["prompt", "pi-prompt"],
  ["theme", "pi-theme"],
];

interface CacheEntry {
  expiresAt: number;
  value: PluginSearchResponse;
}

interface TypeCacheEntry {
  expiresAt: number;
  types: PluginPackageType[];
}

interface NpmSearchPayload {
  objects?: unknown;
  total?: unknown;
}

export interface PluginSearchParams {
  query?: string;
  page?: number;
}

export interface PluginSearchDeps {
  fetch?: typeof fetch;
  now?: () => number;
  registryBase?: string;
}

const cache = new Map<string, CacheEntry>();
const typeCache = new Map<string, TypeCacheEntry>();

export function clearPluginSearchCache(): void {
  cache.clear();
  typeCache.clear();
}

let npmrcRegistry: string | undefined;
let npmrcRegistryRead = false;

/** Reuse the registry configured for npm installs, so search and install agree. */
function readNpmrcRegistry(): string | undefined {
  if (npmrcRegistryRead) return npmrcRegistry;
  npmrcRegistryRead = true;
  try {
    const path = process.env.npm_config_userconfig || join(homedir(), ".npmrc");
    const match = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(readFileSync(path, "utf8"));
    npmrcRegistry = match?.[1];
  } catch {
    npmrcRegistry = undefined;
  }
  return npmrcRegistry;
}

function normalizeBase(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function registryBase(): string {
  const configured =
    process.env.PI_PLUGIN_REGISTRY || process.env.npm_config_registry || readNpmrcRegistry() || DEFAULT_REGISTRY;
  return normalizeBase(configured, DEFAULT_REGISTRY);
}

function isOffline(): boolean {
  const value = process.env.PI_OFFLINE;
  return typeof value === "string" && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

function sanitizeQuery(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RpcError({ code: "BAD_REQUEST", message: "Search query must be text" });
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Search query is too long" });
  }
  return normalized;
}

function normalizePage(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(1_000, Math.max(1, Math.trunc(value)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalize one npm search hit; returns null for entries that are not Pi packages. */
export function normalizePluginSearchEntry(value: unknown): PluginSearchResult | null {
  const entry = asRecord(value);
  const pkg = asRecord(entry?.package);
  const name = asString(pkg?.name);
  if (!name) return null;

  const keywords = Array.isArray(pkg?.keywords)
    ? pkg.keywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
  if (!keywords.some((keyword) => keyword.toLowerCase() === PI_PACKAGE_KEYWORD)) return null;

  const links = asRecord(pkg?.links);
  const publisher = asRecord(pkg?.publisher);
  const downloads = asRecord(entry?.downloads);
  const repository = asString(links?.repository);

  return {
    name,
    version: asString(pkg?.version) ?? "0.0.0",
    ...(asString(pkg?.description) ? { description: asString(pkg?.description)! } : {}),
    ...(asString(publisher?.username) ? { publisher: asString(publisher?.username)! } : {}),
    ...(asString(pkg?.license) ? { license: asString(pkg?.license)! } : {}),
    types: typesFromKeywords(keywords),
    keywords,
    ...(asNumber(downloads?.monthly) !== undefined ? { monthlyDownloads: asNumber(downloads?.monthly)! } : {}),
    ...(asString(entry?.updated) ? { updatedAt: asString(entry?.updated)! } : {}),
    ...(repository ? { repository } : {}),
    npmUrl: asString(links?.npm) ?? `https://www.npmjs.com/package/${name}`,
  };
}

/** Only `pi-*` keyword hints are trusted; generic words like "extension" are not. */
function typesFromKeywords(keywords: readonly string[]): PluginPackageType[] {
  const lower = keywords.map((keyword) => keyword.toLowerCase());
  return TYPE_KEYWORDS.filter(([, keyword]) => lower.includes(keyword)).map(([type]) => type);
}

export function buildRegistrySearchUrl(base: string, query: string, size: number, from: number): URL {
  const url = new URL(`${base}/-/v1/search`);
  url.searchParams.set("text", query ? `keywords:${PI_PACKAGE_KEYWORD} ${query}` : `keywords:${PI_PACKAGE_KEYWORD}`);
  url.searchParams.set("size", String(size));
  if (from > 0) url.searchParams.set("from", String(from));
  return url;
}

/** Read the resource types a package declares in its published manifest. */
function typesFromManifest(manifest: Record<string, unknown>): PluginPackageType[] {
  const pi = asRecord(manifest.pi);
  const declared: PluginPackageType[] = [];
  for (const [type, key] of TYPE_MANIFEST_KEYS) {
    const value = pi?.[key];
    const present = Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
    if (present) declared.push(type);
  }
  if (declared.length > 0) return declared;
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
  return typesFromKeywords(keywords);
}

async function fetchPackageTypes(
  name: string,
  base: string,
  fetcher: typeof fetch,
  now: number,
): Promise<PluginPackageType[]> {
  const key = `${base}\0${name}`;
  const cached = typeCache.get(key);
  if (cached && cached.expiresAt > now) return cached.types;

  let types: PluginPackageType[] = [];
  try {
    const response = await fetcher(`${base}/${encodeURIComponent(name)}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TYPE_TIMEOUT_MS),
    });
    if (response.ok) {
      const raw = await response.text();
      if (raw.length <= MAX_RESPONSE_BYTES) types = typesFromManifest(asRecord(JSON.parse(raw)) ?? {});
    }
  } catch {
    // Type badges are best-effort; a failed manifest fetch must not fail search.
  }
  typeCache.set(key, { expiresAt: now + TYPE_CACHE_TTL_MS, types });
  while (typeCache.size > CACHE_MAX_ENTRIES * 4) {
    const oldest = typeCache.keys().next().value;
    if (oldest === undefined) break;
    typeCache.delete(oldest);
  }
  return types;
}

/**
 * Resolve manifest-declared resource types for one page of packages. Search stays
 * fast and keyword-typed; the renderer fills badges through this second call.
 */
export async function resolvePluginTypes(
  names: unknown,
  deps: PluginSearchDeps = {},
): Promise<Record<string, PluginPackageType[]>> {
  if (!Array.isArray(names)) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Package names must be an array" });
  }
  const unique = [
    ...new Set(
      names.filter((name): name is string => typeof name === "string" && name.length <= 214 && PACKAGE_NAME.test(name)),
    ),
  ].slice(0, MAX_TYPE_NAMES);
  const result: Record<string, PluginPackageType[]> = {};
  if (unique.length === 0) return result;

  const base = deps.registryBase ?? registryBase();
  const now = deps.now?.() ?? Date.now();
  const fetcher = deps.fetch ?? fetch;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(TYPE_CONCURRENCY, unique.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= unique.length) return;
        const name = unique[index];
        result[name] = await fetchPackageTypes(name, base, fetcher, now);
      }
    }),
  );
  return result;
}

function cacheKey(source: string, query: string, page: number): string {
  return `${source}\0${query}\0${page}`;
}

function remember(key: string, value: PluginSearchResponse, now: number): void {
  cache.delete(key);
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Search the npm registry for Pi packages. Results are keyword-filtered, typed
 * from each package's manifest when available, and cached briefly.
 */
export async function searchPluginRegistry(
  input: PluginSearchParams = {},
  deps: PluginSearchDeps = {},
): Promise<PluginSearchResponse> {
  if (isOffline()) {
    throw new RpcError({
      code: "BAD_REQUEST",
      message: "Package search is unavailable in offline mode.",
    });
  }

  const query = sanitizeQuery(input.query);
  const page = normalizePage(input.page);
  const base = deps.registryBase ?? registryBase();
  const now = deps.now?.() ?? Date.now();
  const key = cacheKey(base, query, page);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return { ...cached.value, cached: true };

  const fetcher = deps.fetch ?? fetch;
  const from = (page - 1) * PAGE_SIZE;
  const url = buildRegistrySearchUrl(base, query, PAGE_SIZE, from);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json", "user-agent": "serphia-pi-package-search" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RpcError({ code: "INTERNAL", message: `Package registry request failed: ${reason}` });
  }
  if (!response.ok) {
    throw new RpcError({ code: "INTERNAL", message: `Package registry returned HTTP ${response.status}` });
  }

  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    throw new RpcError({ code: "INTERNAL", message: "Package registry response is too large" });
  }

  let payload: NpmSearchPayload;
  try {
    payload = JSON.parse(raw) as NpmSearchPayload;
  } catch {
    throw new RpcError({ code: "INTERNAL", message: "Package registry returned invalid JSON" });
  }

  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  const results = objects
    .map(normalizePluginSearchEntry)
    .filter((entry): entry is PluginSearchResult => entry !== null);

  const value: PluginSearchResponse = {
    results,
    total: asNumber(payload.total) ?? from + objects.length,
    page,
    hasMore: objects.length === PAGE_SIZE,
    source: "npm",
    registry: base,
  };
  remember(key, value, now);
  return value;
}
