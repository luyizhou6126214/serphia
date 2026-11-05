import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Image as ImageIcon,
  Info,
  Search,
  Settings2,
  Sparkles,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import {
  buildTrajectory,
  formatTrajectoryCost,
  formatTrajectoryDuration,
  formatTrajectoryTokens,
  type TrajectoryRow,
  type TrajectoryStatus,
} from "@/lib/trajectory";
import type { AgentMessage } from "@/lib/types";
import type { AgentPhase } from "@/lib/session-turn-state";
import { useTrajectoryContext } from "@/hooks/useTrajectoryContext";
import { TrajectoryInspector } from "./TrajectoryInspector";
import { TrajectoryTimeline } from "./TrajectoryTimeline";
import "./TrajectoryView.css";

type Translate = (key: string, fallback: string) => string;

interface Props {
  messages: readonly AgentMessage[];
  entryIds: readonly string[];
  runningToolCallIds: ReadonlySet<string>;
  streamingMessage: Partial<AgentMessage> | null;
  agentRunning: boolean;
  agentPhase: AgentPhase;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  modelNames?: Record<string, string>;
  sessionId?: string | null;
  leafId?: string | null;
}

const ROW_KIND_ICON: Record<TrajectoryRow["kind"], ReactNode> = {
  user: <User size={10} strokeWidth={1.8} aria-hidden="true" />,
  assistant: <Sparkles size={10} strokeWidth={1.8} aria-hidden="true" />,
  tool: <Wrench size={10} strokeWidth={1.8} aria-hidden="true" />,
  context: <Info size={10} strokeWidth={1.8} aria-hidden="true" />,
  system: <Settings2 size={10} strokeWidth={1.8} aria-hidden="true" />,
};

function useTrajectoryNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function clock(timestamp: number | undefined, language: string): string | null {
  if (typeof timestamp !== "number") return null;
  const value = new Date(timestamp);
  const now = new Date();
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  const time = value.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (sameDay) return time;
  const date = value.toLocaleDateString(language, { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

function kindLabel(kind: TrajectoryRow["kind"], t: Translate): string {
  switch (kind) {
    case "user":
      return t("trajectoryKindUser", "User");
    case "assistant":
      return t("trajectoryKindAssistant", "Assistant");
    case "tool":
      return t("trajectoryKindTool", "Tool");
    case "context":
      return t("trajectoryKindContext", "Context");
    default:
      return t("trajectoryKindSystem", "System");
  }
}

function statusLabel(status: TrajectoryStatus, t: Translate): string {
  switch (status) {
    case "failed":
      return t("trajectoryStatusFailed", "Failed");
    case "running":
      return t("trajectoryStatusRunning", "Running");
    case "pending":
      return t("trajectoryStatusPending", "Pending");
    case "aborted":
      return t("trajectoryStatusAborted", "Aborted");
    default:
      return t("trajectoryStatusCompleted", "Completed");
  }
}

function rowHaystack(row: TrajectoryRow): string {
  return [
    row.kind,
    row.title,
    row.text,
    row.detailText?.slice(0, 4_000),
    row.toolName,
    row.toolInput?.slice(0, 4_000),
    row.toolOutput?.slice(0, 8_000),
    row.model,
    row.provider,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function phaseLabel(phase: AgentPhase, t: Translate): string {
  if (!phase) return t("trajectoryRunning", "Running");
  if (phase.kind === "waiting_model") return t("trajectoryWaitingModel", "Waiting for model…");
  if (phase.kind === "running_command") return t("trajectoryRunningCommand", "Running command…");
  const names = phase.tools
    .map((tool) => tool.name)
    .filter(Boolean)
    .join(", ");
  return names
    ? t("trajectoryRunningTools", "Calling {name}…").replace("{name}", names)
    : t("trajectoryRunning", "Running");
}

function toggleSet(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function toggleNumberSet(set: ReadonlySet<number>, value: number): Set<number> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function TrajectoryRowView({
  row,
  language,
  t,
  selected,
  expanded,
  onSelect,
  onToggle,
}: {
  row: TrajectoryRow;
  language: string;
  t: Translate;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const time = clock(row.timestamp, language);
  const duration = row.kind === "tool" ? formatTrajectoryDuration(row.durationMs) : null;
  const tokens = formatTrajectoryTokens(row.usage?.total);
  const cost = formatTrajectoryCost(row.usage?.cost);
  const currentModel = row.notice === "model" ? row.model : null;
  const title =
    row.notice === "model"
      ? t("trajectoryModelChanged", "Model changed to {model}").replace("{model}", currentModel ?? "")
      : row.notice === "compaction"
        ? t("trajectoryCompaction", "Context compacted")
        : row.notice === "system-prompt"
          ? t("trajectorySystemPrompt", "Initial system prompt")
          : row.kind === "context" && row.title === "context_edit"
            ? t("trajectoryContextEdit", "Context edit")
            : null;
  const text =
    row.notice === "model" || row.notice === "system-prompt"
      ? title
      : row.notice === "compaction"
        ? row.text
          ? `${title} · ${row.text}`
          : title
        : row.text || title;
  const empty = !text;
  const toolOnly = row.kind === "assistant" && !row.text;
  const imageOnlyLabel = row.images ? `${t("trajectoryImages", "Images")} ×${row.images}` : null;
  const fileOnlyLabel = row.files ? `${t("trajectoryFiles", "Files")} ×${row.files}` : null;
  const expandable = row.kind === "tool" && Boolean(row.toolInput || row.toolOutput);
  const resultPreview = row.kind === "tool" && row.detailText ? row.detailText : null;
  return (
    <>
      <div
        className="trajectory-row"
        data-row-id={row.id}
        data-kind={row.kind}
        data-status={row.status}
        data-selected={selected || undefined}
        role="button"
        tabIndex={0}
        aria-expanded={expandable ? expanded : undefined}
        aria-label={`${kindLabel(row.kind, t)}: ${
          text || imageOnlyLabel || fileOnlyLabel || t("trajectoryNoContent", "No content")
        }`}
        onClick={onSelect}
        onDoubleClick={(event) => {
          if (!expandable) return;
          event.preventDefault();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        }}
      >
        <span className="trajectory-row-kind">
          <span className="trajectory-kind-tag" data-kind={row.kind}>
            {ROW_KIND_ICON[row.kind]}
            {kindLabel(row.kind, t)}
          </span>
        </span>
        <span className="trajectory-row-content">
          {row.kind === "tool" && row.toolName && <span className="trajectory-row-tool-name">{row.toolName}</span>}
          <span className="trajectory-row-text" data-empty={empty || undefined}>
            {empty
              ? toolOnly
                ? t("trajectoryToolOnly", "Tool calls only")
                : imageOnlyLabel || fileOnlyLabel || t("trajectoryNoContent", "No content")
              : text}
          </span>
          {resultPreview && (
            <span className="trajectory-row-result" data-error={row.isError || undefined}>
              <span aria-hidden="true">→</span>
              <span className="trajectory-row-result-text">{resultPreview}</span>
            </span>
          )}
        </span>
        <span className="trajectory-row-meta">
          {!!row.images && (
            <span className="trajectory-row-badge" title={t("trajectoryImages", "Images")}>
              <ImageIcon size={10} strokeWidth={1.7} aria-hidden="true" />
              {row.images}
            </span>
          )}
          {!!row.files && <span className="trajectory-row-badge">{row.files}</span>}
          {tokens && <span>{tokens} tok</span>}
          {cost && <span>{cost}</span>}
          {duration && <span>{duration}</span>}
          {time && <span>{time}</span>}
          {(row.status === "running" || row.status === "failed") && (
            <span className="trajectory-row-status">{statusLabel(row.status, t)}</span>
          )}
          {row.status === "failed" && <AlertTriangle size={11} strokeWidth={1.8} aria-hidden="true" />}
          {expandable && (
            <span className="trajectory-row-chevron" aria-hidden="true">
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          )}
        </span>
      </div>
      {expandable && expanded && (
        <div className="trajectory-tool-expansion">
          <div className="trajectory-tool-expansion-section">
            <div className="trajectory-tool-expansion-label">{t("trajectoryToolInput", "Arguments")}</div>
            <pre>{row.toolInput || t("trajectoryNoContent", "No content")}</pre>
          </div>
          <div className="trajectory-tool-expansion-section">
            <div className="trajectory-tool-expansion-label">{t("trajectoryToolResult", "Result")}</div>
            <pre className={row.isError ? "trajectory-inspector-warning" : undefined}>
              {row.toolOutput || t("trajectoryNoOutput", "No output")}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

export function TrajectoryView({
  messages,
  entryIds,
  runningToolCallIds,
  streamingMessage,
  agentRunning,
  agentPhase,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  modelNames,
  sessionId,
  leafId,
}: Props) {
  const { t, language } = useI18n();
  const now = useTrajectoryNow(agentRunning);
  const contextEntries = useTrajectoryContext(sessionId, leafId, true, `${messages.length}:${agentRunning ? 1 : 0}`);
  const snapshot = useMemo(
    () =>
      buildTrajectory(messages, {
        entryIds,
        runningToolCallIds,
        streamingMessage,
        agentRunning,
        agentPhase,
        now,
        modelNames,
        contextEntries,
      }),
    [
      agentRunning,
      agentPhase,
      contextEntries,
      entryIds,
      messages,
      modelNames,
      now,
      runningToolCallIds,
      streamingMessage,
    ],
  );
  const [actualDuration, setActualDuration] = useState(true);
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef(false);
  const lastMessageCountRef = useRef(messages.length);
  const stickToBottomRef = useRef(true);

  const selectedRow = selectedRowId ? (snapshot.rows.find((row) => row.id === selectedRowId) ?? null) : null;
  const allToolRows = useMemo(
    () => snapshot.rows.filter((row) => row.kind === "tool" && Boolean(row.toolInput || row.toolOutput)),
    [snapshot.rows],
  );
  const allTurnsCollapsed = snapshot.turns.length > 0 && snapshot.turns.every((turn) => collapsedTurns.has(turn.index));
  const allToolsExpanded = allToolRows.length > 0 && allToolRows.every((row) => expandedTools.has(row.id));

  const searchMatchIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return new Set(snapshot.rows.filter((row) => rowHaystack(row).includes(needle)).map((row) => row.id));
  }, [query, snapshot.rows]);

  const visibleTurns = useMemo(() => {
    if (!searchMatchIds) return snapshot.turns.map((turn) => ({ turn, rows: turn.rows }));
    return snapshot.turns
      .map((turn) => ({ turn, rows: turn.rows.filter((row) => searchMatchIds.has(row.id)) }))
      .filter((item) => item.rows.length > 0);
  }, [searchMatchIds, snapshot.turns]);

  useEffect(() => {
    const ledger = ledgerRef.current;
    if (!ledger || initialScrollRef.current || snapshot.rows.length === 0) return;
    initialScrollRef.current = true;
    // Short sessions open at the start; settled long histories open at the live tail.
    if (ledger.scrollHeight > ledger.clientHeight * 1.8) ledger.scrollTop = ledger.scrollHeight;
  }, [snapshot.rows.length]);

  useEffect(() => {
    const ledger = ledgerRef.current;
    const grew = messages.length > lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;
    if (!ledger || !initialScrollRef.current || !grew || !stickToBottomRef.current) return;
    ledger.scrollTop = ledger.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (selectedRowId && !snapshot.rows.some((row) => row.id === selectedRowId)) setSelectedRowId(null);
  }, [selectedRowId, snapshot.rows]);

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    const row = snapshot.rows.find((candidate) => candidate.id === rowId);
    if (row && row.turn > 0 && collapsedTurns.has(row.turn)) {
      setCollapsedTurns((current) => toggleNumberSet(current, row.turn));
    }
    requestAnimationFrame(() => {
      const ledger = ledgerRef.current;
      const element = ledger?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  };

  const loadOlder = async () => {
    const ledger = ledgerRef.current;
    const previousHeight = ledger?.scrollHeight ?? 0;
    const previousTop = ledger?.scrollTop ?? 0;
    stickToBottomRef.current = false;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (ledger) ledger.scrollTop = previousTop + (ledger.scrollHeight - previousHeight);
    });
  };

  const toggleAllTurns = () => {
    setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(snapshot.turns.map((turn) => turn.index)));
  };

  const toggleAllTools = () => {
    setExpandedTools(allToolsExpanded ? new Set() : new Set(allToolRows.map((row) => row.id)));
  };

  const runningRow = snapshot.rows.at(-1)?.status === "running";

  return (
    <div className="trajectory-view">
      <div className="trajectory-toolbar" role="toolbar" aria-label={t("trajectoryToolbar", "Trajectory toolbar")}>
        <div className="trajectory-toolbar-actions">
          <button
            type="button"
            className="trajectory-toolbar-button"
            aria-pressed={actualDuration}
            aria-label={
              actualDuration
                ? t("trajectoryUseEqualWidth", "Use equal width")
                : t("trajectoryUseActualDuration", "Use actual duration")
            }
            title={
              actualDuration
                ? t("trajectoryUseEqualWidth", "Use equal width")
                : t("trajectoryUseActualDuration", "Use actual duration")
            }
            onClick={() => setActualDuration((value) => !value)}
          >
            <Clock3 size={12} strokeWidth={1.6} aria-hidden="true" />
            {t("trajectoryDuration", "Duration")}
          </button>
          <button
            type="button"
            className="trajectory-toolbar-button"
            aria-pressed={allTurnsCollapsed}
            aria-label={
              allTurnsCollapsed
                ? t("trajectoryExpandTurns", "Expand all turns")
                : t("trajectoryCollapseTurns", "Collapse all turns")
            }
            title={
              allTurnsCollapsed
                ? t("trajectoryExpandTurns", "Expand all turns")
                : t("trajectoryCollapseTurns", "Collapse all turns")
            }
            onClick={toggleAllTurns}
          >
            <ChevronsCollapsed collapsed={allTurnsCollapsed} />
            {t("trajectoryTurns", "Turns")}
          </button>
          <button
            type="button"
            className="trajectory-toolbar-button"
            aria-pressed={allToolsExpanded}
            aria-label={
              allToolsExpanded
                ? t("trajectoryCollapseCalls", "Collapse all calls")
                : t("trajectoryExpandCalls", "Expand all calls")
            }
            title={
              allToolsExpanded
                ? t("trajectoryCollapseCalls", "Collapse all calls")
                : t("trajectoryExpandCalls", "Expand all calls")
            }
            onClick={toggleAllTools}
          >
            <Wrench size={12} strokeWidth={1.6} aria-hidden="true" />
            {t("trajectoryCalls", "Calls")}
          </button>
        </div>
        <div className="trajectory-toolbar-spacer" />
        <div className="trajectory-search">
          <Search size={12} strokeWidth={1.8} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t("trajectorySearchPlaceholder", "Search")}
            aria-label={t("trajectorySearch", "Search trajectory")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setQuery("");
            }}
          />
          {query && (
            <button
              type="button"
              className="trajectory-inspector-close"
              style={{ width: 18, height: 18 }}
              onClick={() => setQuery("")}
              title={t("trajectoryClearSearch", "Clear search")}
              aria-label={t("trajectoryClearSearch", "Clear search")}
            >
              <X size={11} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <TrajectoryTimeline
        snapshot={snapshot}
        actualDuration={actualDuration}
        selectedRowId={selectedRowId}
        searchMatchIds={searchMatchIds}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        onSelectRow={selectRow}
        language={language}
        t={t}
      />

      <div className="trajectory-body">
        <div
          className="trajectory-ledger"
          ref={ledgerRef}
          onScroll={(event) => {
            const target = event.currentTarget;
            stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 48;
          }}
        >
          {hasOlder && (
            <button
              type="button"
              className="trajectory-load-earlier"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder
                ? t("trajectoryLoadingEarlier", "Loading earlier history…")
                : t("trajectoryLoadEarlier", "Load earlier trajectory")}
            </button>
          )}

          {snapshot.rows.length === 0 ? (
            <div className="trajectory-empty">
              <Activity size={22} strokeWidth={1.4} aria-hidden="true" />
              <div className="trajectory-empty-title">{t("trajectoryEmpty", "No trajectory yet")}</div>
              <div className="trajectory-empty-hint">
                {t("trajectoryEmptyHint", "Send a message to see turns, tool calls, timing and usage here.")}
              </div>
            </div>
          ) : visibleTurns.length === 0 ? (
            <div className="trajectory-empty">
              <Search size={20} strokeWidth={1.4} aria-hidden="true" />
              <div className="trajectory-empty-title">{t("trajectorySearchEmpty", "No matching records")}</div>
              <div className="trajectory-empty-hint">
                {t("trajectoryClearSearchHint", "Clear the search to see the full trajectory.")}
              </div>
            </div>
          ) : (
            visibleTurns.map(({ turn, rows }) => {
              const turnLabel =
                turn.index > 0
                  ? t("trajectoryTurn", "Turn {turn}").replace("{turn}", String(turn.index))
                  : t("trajectoryBetweenTurns", "Between turns");
              const collapsed = !searchMatchIds && collapsedTurns.has(turn.index);
              const firstUser = turn.rows.find((row) => row.kind === "user");
              const turnDuration = formatTrajectoryDuration(turn.durationMs);
              const turnTokens = formatTrajectoryTokens(turn.usage?.total);
              const turnCost = formatTrajectoryCost(turn.usage?.cost);
              return (
                <section className="trajectory-turn" key={turn.index} data-turn={turn.index}>
                  <div className="trajectory-turn-header">
                    <button
                      type="button"
                      className="trajectory-turn-toggle"
                      aria-expanded={!collapsed}
                      aria-label={
                        collapsed
                          ? t("trajectoryExpandTurn", "Expand turn")
                          : t("trajectoryCollapseTurn", "Collapse turn")
                      }
                      onClick={() => setCollapsedTurns((current) => toggleNumberSet(current, turn.index))}
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <span className="trajectory-turn-title">{turnLabel}</span>
                    {turn.model && <span className="trajectory-turn-model">{turn.model}</span>}
                    <span className="trajectory-turn-meta">
                      {turn.toolCount > 0 && (
                        <span>
                          {t("trajectoryToolCalls", "{count} tool calls").replace("{count}", String(turn.toolCount))}
                        </span>
                      )}
                      {turnTokens && <span>{turnTokens} tok</span>}
                      {turnCost && <span>{turnCost}</span>}
                      {turnDuration && <span>{turnDuration}</span>}
                      {turn.status !== "completed" && (
                        <span className="trajectory-turn-status" data-status={turn.status}>
                          {statusLabel(turn.status, t)}
                        </span>
                      )}
                    </span>
                  </div>
                  {collapsed ? (
                    <div
                      className="trajectory-turn-collapsed"
                      role="button"
                      tabIndex={0}
                      aria-expanded={false}
                      onClick={() => setCollapsedTurns((current) => toggleNumberSet(current, turn.index))}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setCollapsedTurns((current) => toggleNumberSet(current, turn.index));
                      }}
                    >
                      <span>{firstUser?.text || t("trajectoryNoContent", "No content")}</span>
                    </div>
                  ) : (
                    rows.map((row) => (
                      <TrajectoryRowView
                        key={row.id}
                        row={row}
                        language={language}
                        t={t}
                        selected={selectedRowId === row.id}
                        expanded={expandedTools.has(row.id)}
                        onSelect={() => selectRow(row.id)}
                        onToggle={() => setExpandedTools((current) => toggleSet(current, row.id))}
                      />
                    ))
                  )}
                </section>
              );
            })
          )}

          {agentRunning && !runningRow && <div className="trajectory-running-footer">{phaseLabel(agentPhase, t)}</div>}
        </div>

        {selectedRow && (
          <TrajectoryInspector row={selectedRow} language={language} t={t} onClose={() => setSelectedRowId(null)} />
        )}
      </div>
    </div>
  );
}

function ChevronsCollapsed({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      {collapsed ? (
        <>
          <path d="M4 6.5 8 10l4-3.5" />
          <path d="M4 3.5 8 7l4-3.5" />
        </>
      ) : (
        <>
          <path d="M4 9.5 8 6l4 3.5" />
          <path d="M4 12.5 8 9l4 3.5" />
        </>
      )}
    </svg>
  );
}
