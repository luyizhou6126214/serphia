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
    { name: "todos", description: t("slashCommandTodos", "Show the current branch’s to-do list"), source: "builtin" },
  ];
}

export function isDesktopMcpCommand(command: SlashCommandInfo): boolean {
  return command.source === "extension" && command.sourceInfo?.path === "builtin:mcp" && command.name === "mcp";
}

export function isPackageSlashCommand(command: SlashCommandPaletteItem): boolean {
  return (command.source === "extension" || command.source === "prompt") && command.sourceInfo?.origin === "package";
}

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

export function groupSlashCommands(commands: readonly SlashCommandPaletteItem[], offset = 0) {
  const groups = new Map<SlashCommandSource, { command: SlashCommandPaletteItem; index: number }[]>(
    SLASH_SOURCES.map((source) => [source, []]),
  );
  commands.forEach((command, index) => {
    groups.get(command.source)?.push({ command, index: offset + index });
  });
  return Array.from(groups, ([source, items]) => ({ source, items })).filter((group) => group.items.length > 0);
}

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
