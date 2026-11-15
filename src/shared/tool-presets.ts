import { ORCHESTRATION_TOOL_NAMES } from "./orchestration-tools.ts";
import { isMcpManagedTool } from "./mcp-tool-policy.ts";
import { isAgentShell, type AgentShell } from "./agent-shell.ts";

export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  available?: boolean;
  executionAllowed?: boolean;
}

export type ToolPreset = "none" | "default" | "full";

export const PRESET_NONE: string[] = [];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const CODING_FULL_TOOLS = ["bash", "read", "edit", "write", "grep", "find", "ls"];
export const PRESET_FULL: string[] = [...CODING_FULL_TOOLS, ...ORCHESTRATION_TOOL_NAMES];

// Shell and search tools depend on the toolchain. A saved selection only records granted tools.
const FULL_PRESET_REQUIRED = ["read", "edit", "write", "ls", ...ORCHESTRATION_TOOL_NAMES];

export function codingToolAvailability(
  platform: string,
  capabilities: Readonly<Record<string, unknown>>,
  shell?: AgentShell,
) {
  const required: Record<string, string> = {
    bash: "shell.bash",
    powershell: "shell.powershell",
    grep: "search.rg",
    find: "search.fd",
  };
  return [...CODING_FULL_TOOLS, ...(platform === "win32" ? ["powershell"] : [])].map((name) => ({
    name,
    available:
      (!shell || !isAgentShell(name) || name === shell) && (!required[name] || Boolean(capabilities[required[name]])),
  }));
}

export function getPresetFromToolNames(names: readonly string[]): ToolPreset {
  if (!names.length) return "none";
  return FULL_PRESET_REQUIRED.every((name) => names.includes(name)) ? "full" : "default";
}

/** Declarations alone must not become a new execution grant when another checkbox is edited. */
export function getSelectedToolNames(tools: readonly ToolEntry[]): string[] {
  return tools
    .filter(
      (tool) =>
        tool.active &&
        tool.executionAllowed !== false &&
        (tool.executionAllowed === true || (tool.name !== "powershell" && !isMcpManagedTool(tool.name))),
    )
    .map((tool) => tool.name);
}

export function getToolNamesForPreset(
  preset: ToolPreset,
  tools?: readonly Pick<ToolEntry, "name" | "available">[],
): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "full")
    return [
      ...PRESET_FULL,
      ...(tools?.some((tool) => tool.name === "powershell" && tool.available !== false) ? ["powershell"] : []),
    ].filter((name) => !tools?.some((tool) => tool.name === name && tool.available === false));
  const shell =
    tools?.some((tool) => tool.name === "bash" && tool.available === false) &&
    tools.some((tool) => tool.name === "powershell" && tool.available !== false)
      ? "powershell"
      : "bash";
  return PRESET_DEFAULT.map((name) => (name === "bash" ? shell : name));
}
