import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ArrowDown, CornerDownLeft, FolderOpen, MessageCircle, Search, SquarePen, X } from "lucide-react";
import { useI18n } from "@/i18n";
import type { SessionInfo } from "@/lib/types";
import { getSessionDisplayTitle, sessionMatchesQuery } from "@/lib/session-list";
import { isDefaultSessionDirectory } from "@shared/session-workspace";

type SearchTab = "all" | "actions" | "chats";
type SearchItem = { id: string; label: string; session?: SessionInfo; action?: "new" | "folder" };

export function SessionSearchDialog({
  sessions,
  loading,
  error,
  onClose,
  onSelectSession,
  onNewSession,
  onOpenFolder,
}: {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onNewSession: () => void;
  onOpenFolder?: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const busyRef = useRef(false);
  const alive = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const listId = useId();
  const actions: SearchItem[] = [
    { id: "new", label: t("newSession", "new session"), action: "new" as const },
    ...(onOpenFolder ? [{ id: "folder", label: t("searchOpenFolder", "Open folder"), action: "folder" as const }] : []),
  ].filter((item) => tab !== "chats" && item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const matches = useMemo(
    () =>
      sessions
        .filter((session) => sessionMatchesQuery(session, query))
        .sort((a, b) => b.modified.localeCompare(a.modified)),
    [sessions, query],
  );
  const chats: SearchItem[] =
    tab === "actions"
      ? []
      : matches
          .slice(0, limit)
          .map((session) => ({ id: session.id, label: getSessionDisplayTitle(session, 160), session }));
  const items = [...actions, ...chats];
  const selectedIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
  const selectedItem = items[selectedIndex];
  const selectedId = selectedItem?.id;

  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      alive.current = false;
      document.body.style.overflow = overflow;
      previousFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (selectedId) optionRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  const choose = async (item: SearchItem) => {
    if (busyRef.current) return;
    if (item.session) {
      onClose();
      onSelectSession(item.session);
    } else if (item.action === "new") {
      onClose();
      onNewSession();
    } else if (item.action === "folder" && onOpenFolder) {
      busyRef.current = true;
      setBusy(true);
      setActionError("");
      try {
        const opened = await onOpenFolder();
        if (alive.current && opened) onClose();
      } catch (cause) {
        if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
          inputRef.current?.focus();
        }
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      const controls = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled]):not([tabindex='-1'])") ??
          []),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    } else if (event.target === inputRef.current && !event.nativeEvent.isComposing) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
        event.preventDefault();
        setActiveIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      } else if (event.key === "Enter" && selectedItem) {
        event.preventDefault();
        void choose(selectedItem);
      }
    }
  };

  const renderItem = (item: SearchItem, index: number) => {
    const project = isDefaultSessionDirectory(item.session?.cwd)
      ? undefined
      : item.session?.projectRoot || item.session?.cwd;
    const projectLabel = project
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop();
    const Icon = item.session ? MessageCircle : item.action === "new" ? SquarePen : FolderOpen;
    return (
      <button
        key={item.id}
        id={`${listId}-${item.id}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={index === selectedIndex}
        disabled={busy}
        ref={(node) => {
          if (node) optionRefs.current.set(item.id, node);
          else optionRefs.current.delete(item.id);
        }}
        className={`session-search-option${index === selectedIndex ? " is-selected" : ""}`}
        onMouseMove={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void choose(item)}
      >
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
        <span className="session-search-option-label">{item.label}</span>
        {item.session && (
          <span className="session-search-project" title={project || undefined}>
            {projectLabel || t("searchNoProject", "No project")}
          </span>
        )}
      </button>
    );
  };

  return createPortal(
    <div
      className="session-search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="session-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("searchSessions", "Search sessions")}
        onKeyDown={onKeyDown}
      >
        <div className="session-search-input-row">
          <Search size={20} strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={selectedItem ? `${listId}-${selectedItem.id}` : undefined}
            aria-label={t("searchSessions", "Search sessions")}
            placeholder={t("searchPanelPlaceholder", "Search chats or run a command")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setLimit(50);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="session-search-close" onClick={onClose} aria-label={t("close", "Close")}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div
          className="session-search-results"
          id={listId}
          role="listbox"
          aria-label={t("searchResults", "Search results")}
          aria-busy={loading || busy}
        >
          {actions.length > 0 && (
            <>
              <div className="session-search-section" role="presentation">
                {t("searchQuickActions", "Quick actions")}
              </div>
              {actions.map(renderItem)}
            </>
          )}
          {chats.length > 0 && (
            <>
              <div className="session-search-section" role="presentation">
                {query.trim() ? t("searchResults", "Search results") : t("searchRecentChats", "Recent chats")}
              </div>
              {chats.map((item, index) => renderItem(item, actions.length + index))}
            </>
          )}
          {tab !== "actions" && chats.length === 0 && (
            <div className="session-search-empty">
              {loading
                ? t("loading", "Loading…")
                : error ||
                  (query.trim()
                    ? t("noMatchingSessions", "No matching sessions")
                    : t("searchNoSessions", "No sessions yet"))}
            </div>
          )}
          {tab === "actions" && actions.length === 0 && (
            <div className="session-search-empty">{t("searchNoActions", "No matching actions")}</div>
          )}
        </div>
        {tab !== "actions" && matches.length > limit && (
          <button type="button" className="session-search-more" onClick={() => setLimit((value) => value + 50)}>
            {t("showMoreSessions", "Show more")}
          </button>
        )}
        {actionError && (
          <div className="session-search-error" role="alert">
            {actionError}
          </div>
        )}
        <div className="session-search-footer">
          <div className="session-search-tabs" role="group" aria-label={t("searchCategory", "Search category")}>
            {(
              [
                ["all", t("searchAll", "All")],
                ["actions", t("searchActions", "Actions")],
                ["chats", t("searchChats", "Chats")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                className={tab === value ? "is-active" : ""}
                onClick={() => {
                  setTab(value);
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="session-search-key-hint" aria-hidden="true">
            <ArrowUp size={12} />
            <ArrowDown size={12} /> <CornerDownLeft size={13} />
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
