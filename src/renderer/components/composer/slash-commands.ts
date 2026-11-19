import type { SlashCommandInfo } from "@/hooks/useAgentSession";
import type { useI18n } from "@/i18n";

export const SLASH_COMMAND_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export type SlashCommandPaletteItem =
  | SlashCommandInfo
  | {
      name: string;
      description: string;
      source: "builtin";
    };

export type SlashCommandSource = SlashCommandPaletteItem["source"];

type Translate = ReturnType<typeof useI18n>["t"];

export function builtinSlashCommands(t: Translate): SlashCommandPaletteItem[] {
  return [
    {
      name: "compact",
      description: t("slashCommandCompact", "Compress context, optionally with instructions"),
      source: "builtin",
    },
    {
      name: "reload",
      description: t("slashCommandReload", "Reload extensions, skills, prompts, and tools"),
      source: "builtin",
    },
    { name: "name", description: t("slashCommandName", "Set the session display name"), source: "builtin" },
    {
      name: "session",
      description: t("slashCommandSession", "Show session message, token, and cost stats"),
      source: "builtin",
    },
    { name: "copy", description: t("slashCommandCopy", "Copy the last assistant message"), source: "builtin" },
  ];
}

export function localizeSlashCommand(command: SlashCommandInfo, t: Translate): SlashCommandInfo {
  if (command.source !== "extension") return command;
  // Only translate app-provided commands; a third-party extension can register the same name.
  const path = command.sourceInfo?.path;
  const name = command.name.split(":", 1)[0];
  if (path === "builtin:mcp" && name === "mcp") {
    return { ...command, description: t("slashCommandMcp", "Manage MCP servers in Desktop Settings") };
  }
  return command;
}

export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

export const SLASH_SOURCE_GROUP_LABEL: Record<SlashCommandSource, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  prompt: "Prompts",
  skill: "Skills",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

export function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}
