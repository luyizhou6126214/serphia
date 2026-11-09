import { call } from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo, PluginSearchResult } from "@/lib/api-types";
import { formatCompactNumber, formatRelativeDateTime } from "@/lib/locale-format";
import { pluginRequestError } from "@/lib/plugin-presentation";
import { ActionButton, PackageGlyph, PanelCard, TypeBadge } from "./plugin-ui";
import { hoverLift, usePulse, useStaggerIn } from "./usePluginMotion";

function InstalledMark({ name, animate }: { name: string; animate: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLSpanElement>(null);
  usePulse(ref, animate ? name : null);
  return (
    <span
      ref={ref}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-soft-border)",
        color: "var(--accent)",
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
      {t("pluginInstalled", "Installed")}
    </span>
  );
}

function registryLabel(registry: string | undefined): string {
  if (!registry) return "npm";
  try {
    return new URL(registry).host;
  } catch {
    return registry;
  }
}

/** npm-registry discovery: the same source `pi install` uses. */
export function PluginSearchPanel({
  packages,
  onInstall,
}: {
  packages: PluginPackageInfo[];
  onInstall: (name: string) => Promise<boolean>;
}) {
  const { language, t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const requestedTypes = useRef(new Set<string>());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [registry, setRegistry] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [lastInstalled, setLastInstalled] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const installedNames = useMemo(() => {
    const names = new Set<string>();
    for (const pkg of packages) {
      if (pkg.packageName) names.add(pkg.packageName);
      const spec = pkg.source.startsWith("npm:") ? pkg.source.slice(4) : "";
      if (!spec) continue;
      const lastAt = spec.lastIndexOf("@");
      const nameEnd = spec.startsWith("@") ? spec.indexOf("/", 1) : 0;
      names.add(lastAt > nameEnd ? spec.slice(0, lastAt) : spec);
    }
    return names;
  }, [packages]);

  /** Fill manifest-declared type badges without blocking the first paint. */
  const enrichTypes = useCallback((items: PluginSearchResult[]) => {
    const missing = items
      .filter((item) => !(Array.isArray(item.types) && item.types.length > 0) && !requestedTypes.current.has(item.name))
      .map((item) => item.name)
      .slice(0, 50);
    if (missing.length === 0) return;
    for (const name of missing) requestedTypes.current.add(name);
    void call("plugins.types", { names: missing })
      .then((data) => {
        const typesByName = data?.types ?? {};
        setResults((current) =>
          current.map((item) => {
            const types = typesByName[item.name];
            const missingTypes = !Array.isArray(item.types) || item.types.length === 0;
            return missingTypes && Array.isArray(types) && types.length > 0 ? { ...item, types } : item;
          }),
        );
      })
      .catch(() => undefined);
  }, []);

  const runSearch = useCallback(
    async (next: { query: string; page: number }, append: boolean) => {
      const requestId = ++sequence.current;
      setSearching(true);
      setError(null);
      try {
        const data = await call("plugins.search", { query: next.query.trim(), page: next.page });
        if (requestId !== sequence.current) return;
        // Guard against a stale Host that predates the current response shape.
        const items = Array.isArray(data?.results) ? data.results : [];
        if (!append) requestedTypes.current.clear();
        setResults((current) => (append ? [...current, ...items] : items));
        setHasMore(data?.hasMore === true);
        setPage(typeof data?.page === "number" ? data.page : next.page);
        setRegistry(typeof data?.registry === "string" ? data.registry : "");
        if (!append) setVersion((current) => current + 1);
        enrichTypes(items);
      } catch (caught) {
        if (requestId !== sequence.current) return;
        if (!append) setResults([]);
        setError(pluginRequestError(caught, t("pluginSearchFailed", "Package search failed.")));
      } finally {
        if (requestId === sequence.current) setSearching(false);
      }
    },
    [enrichTypes, t],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Browse popular packages on open, matching the marketplace default view.
  useEffect(() => {
    void runSearch({ query: "", page: 1 }, false);
  }, [runSearch]);

  useStaggerIn(gridRef, "[data-plugin-result]", version, { y: 10, stagger: 0.025, duration: 0.3 });

  const submit = useCallback(() => {
    void runSearch({ query, page: 1 }, false);
  }, [query, runSearch]);

  const loadMore = useCallback(() => {
    if (!hasMore || searching) return;
    void runSearch({ query, page: page + 1 }, true);
  }, [hasMore, page, query, runSearch, searching]);

  const install = useCallback(
    async (item: PluginSearchResult) => {
      if (installingName) return;
      setInstallingName(item.name);
      setError(null);
      try {
        const installed = await onInstall(item.name);
        if (installed) setLastInstalled(item.name);
      } finally {
        setInstallingName(null);
      }
    },
    [installingName, onInstall],
  );

  return (
    <PanelCard
      style={{
        overflow: "hidden",
        background: "var(--bg)",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: 16,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="search"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder={t("pluginSearchPlaceholder", "Search Pi packages, e.g. web access, mcp, todo")}
            aria-label={t("pluginBrowsePackages", "Browse packages")}
            style={{
              width: "100%",
              height: 42,
              padding: "0 12px 0 34px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 13,
              outline: "none",
              transition: "border-color 140ms ease, box-shadow 140ms ease",
            }}
            onFocus={(event) => {
              event.currentTarget.style.borderColor = "var(--accent-soft-border)";
              event.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
            }}
            onBlur={(event) => {
              event.currentTarget.style.borderColor = "var(--border)";
              event.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>
        <ActionButton onClick={submit} disabled={searching} tone="primary">
          {searching ? t("loading", "Loading…") : t("search", "Search")}
        </ActionButton>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10.5,
          color: "var(--text-dim)",
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {t("pluginRegistryNote", "Search and install use the same npm registry")}
          <button
            type="button"
            onClick={() => void window.piBridge?.openExternal("https://www.npmjs.com/search?q=keywords%3Api-package")}
            aria-label={t("pluginOpenNpmRegistry", "Open npm keyword search")}
            title={registry || undefined}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 10.5,
              fontFamily: "var(--font-mono)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            {`${registryLabel(registry)} ↗`}
          </button>
        </span>
        <span>{t("pluginPageLabel", "Page {page}").replace("{page}", String(page))}</span>
      </div>

      <div
        ref={gridRef}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          alignContent: "start",
          gap: 16,
          padding: 16,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {results.length === 0 ? (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: "42px 16px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            {searching ? t("loading", "Loading…") : (error ?? t("pluginSearchEmpty", "No matching Pi packages"))}
          </div>
        ) : (
          results.map((item) => {
            const installed = installedNames.has(item.name);
            const types = Array.isArray(item.types) ? item.types : [];
            return (
              <article
                key={item.name}
                data-plugin-result="true"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minWidth: 0,
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  transition: "border-color 160ms ease, box-shadow 160ms ease",
                }}
                onMouseEnter={(event) => {
                  hoverLift(event.currentTarget, -2);
                  event.currentTarget.style.borderColor = "var(--accent-soft-border)";
                  event.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.06)";
                }}
                onMouseLeave={(event) => {
                  hoverLift(event.currentTarget, 0);
                  event.currentTarget.style.borderColor = "var(--border)";
                  event.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <PackageGlyph name={item.name} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        fontSize: 10,
                        color: "var(--text-dim)",
                      }}
                    >
                      {item.version && <span style={{ fontFamily: "var(--font-mono)" }}>{`v${item.version}`}</span>}
                      {types.map((entry) => (
                        <TypeBadge key={entry} type={entry} />
                      ))}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {installed ? (
                      <InstalledMark name={item.name} animate={lastInstalled === item.name} />
                    ) : (
                      <ActionButton
                        tone="primary"
                        compact
                        ariaLabel={`${t("install", "Install")} ${item.name}`}
                        disabled={installingName !== null}
                        onClick={() => void install(item)}
                      >
                        {installingName === item.name ? t("installing", "Installing…") : t("install", "Install")}
                      </ActionButton>
                    )}
                  </div>
                </div>

                {item.description && (
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "var(--text-muted)",
                      maxHeight: 40,
                      overflow: "hidden",
                    }}
                  >
                    {item.description}
                  </div>
                )}

                <div
                  style={{
                    marginTop: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {item.publisher && <span>{item.publisher}</span>}
                  {item.monthlyDownloads !== undefined && (
                    <span>
                      {formatCompactNumber(item.monthlyDownloads, language)}{" "}
                      {t("pluginDownloadsPerMonth", "downloads/mo")}
                    </span>
                  )}
                  {item.updatedAt && <span>{formatRelativeDateTime(item.updatedAt, language)}</span>}
                  <button
                    type="button"
                    aria-label={t("pluginOpenNpm", "Open on npm")}
                    onClick={() => void window.piBridge?.openExternal(item.npmUrl)}
                    style={{
                      marginLeft: "auto",
                      border: "none",
                      background: "none",
                      padding: 0,
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      fontSize: 10,
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    {"npm"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {(hasMore || (error && results.length > 0)) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          <span>{error && results.length > 0 ? error : ""}</span>
          {hasMore && (
            <ActionButton onClick={loadMore} disabled={searching} compact>
              {searching ? t("loading", "Loading…") : t("pluginLoadMore", "Load more")}
            </ActionButton>
          )}
        </div>
      )}
    </PanelCard>
  );
}
