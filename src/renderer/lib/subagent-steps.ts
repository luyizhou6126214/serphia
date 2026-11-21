import type {
  AgentMessage,
  CustomMessage,
  ExtensionWidgetItem,
  SubagentActivityItem,
  SubagentActivityStatus,
} from "@/lib/types";

const SUBAGENT_NOTICE_TYPES = new Set([
  "subagent-incremental-child-notify",
  "subagent-notify",
  "subagent-notification",
  "subagent-update",
  "subagent-workspace-notice",
]);

const ASYNC_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";

export function isSubagentTool(name: string): boolean {
  return (
    name === "subagent" ||
    name.startsWith("subagent_") ||
    name === "get_subagent_result" ||
    name === "steer_subagent" ||
    name === "bg_wait" ||
    name === "contact_supervisor"
  );
}

export function isSubagentNotice(message: AgentMessage): boolean {
  return message.role === "custom" && SUBAGENT_NOTICE_TYPES.has(message.customType);
}

export function isSubagentWidget(widget: ExtensionWidgetItem): boolean {
  return widget.key === "subagent-async" && widget.lines.some((line) => line.startsWith(ASYNC_WIDGET_PREFIX));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function label(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, 240) || undefined : undefined;
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function status(value: unknown): SubagentActivityStatus | undefined {
  switch (value) {
    case "complete":
    case "completed":
      return "completed";
    case "failed":
    case "error":
    case "rejected":
      return "error";
    case "queued":
    case "running":
    case "paused":
    case "partial":
    case "stopped":
    case "aborted":
      return value;
    default:
      return undefined;
  }
}

type WidgetSubagentActivity = SubagentActivityItem & { runStartedAt?: number };

export function readSubagentWidget(widget: ExtensionWidgetItem | undefined): WidgetSubagentActivity[] {
  const line = widget?.lines.find((line) => line.startsWith(ASYNC_WIDGET_PREFIX));
  if (!line || line.length > ASYNC_WIDGET_PREFIX.length + 32 * 1024) return [];
  let snapshot: Record<string, unknown>;
  try {
    snapshot = record(JSON.parse(line.slice(ASYNC_WIDGET_PREFIX.length)));
  } catch {
    return [];
  }
  if (snapshot.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.runs))
    return [];

  function readRun(value: unknown, parentId = "", parentStartedAt?: number, depth = 0): SubagentActivityItem[] {
    const run = record(value);
    const id = label(run.id);
    if (!id) return [];
    const key = parentId ? `${parentId}/${id}` : id;
    const startedAt = time(run.startedAt) ?? parentStartedAt;
    const children =
      depth < 3 && Array.isArray(run.children)
        ? run.children.slice(0, 8).flatMap((child) => readRun(child, key, startedAt, depth + 1))
        : [];
    if (children.length) return children;
    const state = status(run.state);
    if (!state) return [];
    const endedAt = time(run.endedAt);
    const name = label(run.label) ?? label(run.agent) ?? id;
    return [
      {
        id: key,
        description: name,
        status: state,
        startedAt,
        durationMs: startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined,
        update: label(run.progressText) ?? label(record(run.activity).currentTool),
      },
    ];
  }

  return snapshot.runs.slice(0, 20).flatMap((run) => {
    const runStartedAt = time(record(run).startedAt);
    return readRun(run).map((agent) => ({ ...agent, runStartedAt: runStartedAt ?? agent.startedAt }));
  });
}

export function readSubagentNotice(message: CustomMessage) {
  const details = record(message.details);
  const runs = Array.isArray(details.runs) ? details.runs : [];
  const run = runs.length === 1 ? record(runs[0]) : {};
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  const body = text.split(/\r?\n\r?\nParent action: /u)[0].trim();
  const header = body.split("\n", 1)[0];
  const legacy =
    /^(?:Workflow child|Background task|Detached foreground task) (completed|failed|stopped|paused)(?: \(needs attention\))?: \*\*(.+?)\*\*/u.exec(
      header,
    );
  return {
    description: label(details.description) ?? label(details.childKey) ?? label(run.agent) ?? label(legacy?.[2]),
    status: status(details.status ?? details.outcome ?? run.status ?? legacy?.[1]),
    body:
      typeof details.message === "string" ? details.message.trim() : legacy ? body.slice(header.length).trim() : body,
  };
}
