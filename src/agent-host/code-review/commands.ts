import type { ReviewCommand } from "../../contract/code-review";
import { ReviewError } from "./output";
import { sessionId } from "./scope";

type CommandSpec = { args: string[]; cwd?: string; filename?: string; file?: string; rule?: string };
const HELP = new Set([
  "review",
  "scan",
  "session",
  "rules",
  "delegate",
  "config",
  "auth",
  "llm",
  "viewer",
  "completion",
]);

function filter(value: string | undefined, choices: readonly string[]) {
  if (!value) return "";
  const values = value.split(",").map((item) => item.trim());
  if (values.some((item) => !choices.includes(item))) throw new ReviewError("failed");
  return values.join(",");
}

export function getCommandSpec(command: ReviewCommand): CommandSpec {
  const output = (kind: string, format?: "text" | "json") => ({
    flags: format === "text" ? [] : ["--json"],
    filename: `ocr-${kind}.${format === "text" ? "txt" : "json"}`,
  });
  switch (command?.kind) {
    case "sessions": {
      const limit = command.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ReviewError("scopeLimit");
      const { flags, filename } = output("sessions", command.format);
      return { args: ["session", "list", ...flags, "--limit", String(limit)], cwd: command.cwd, filename };
    }
    case "sessionShow": {
      const { flags, filename } = output("session", command.format);
      return { args: ["session", "show", ...flags, sessionId(command.id)], cwd: command.cwd, filename };
    }
    case "sessionComments": {
      const severity = filter(command.severity, ["critical", "high", "medium", "low"]);
      const category = filter(command.category, [
        "bug",
        "security",
        "performance",
        "maintainability",
        "test",
        "style",
        "documentation",
        "other",
      ]);
      const { flags, filename } = output("findings", command.format);
      return {
        args: [
          "session",
          "comments",
          ...flags,
          sessionId(command.id),
          ...(severity ? ["--severity", severity] : []),
          ...(category ? ["--category", category] : []),
        ],
        cwd: command.cwd,
        filename,
      };
    }
    case "sessionCompare": {
      const { flags, filename } = output("comparison", command.format);
      return {
        args: ["session", "compare", ...flags, sessionId(command.before), sessionId(command.after)],
        cwd: command.cwd,
        filename,
      };
    }
    case "sessionExport":
      return {
        args: ["session", "export", ...(command.id ? [sessionId(command.id)] : [])],
        cwd: command.cwd,
        filename: "code-review.html",
      };
    case "sessionDelete":
      return { args: ["session", "rm", "--yes", sessionId(command.id)], cwd: command.cwd };
    case "ruleCheck":
      return { args: ["rules", "check"], cwd: command.cwd, file: command.file, rule: command.rule };
    case "completion": {
      if (!["bash", "zsh", "fish", "powershell"].includes(command.shell)) throw new ReviewError("failed");
      return {
        args: ["completion", command.shell],
        filename: `ocr-completion.${command.shell === "powershell" ? "ps1" : command.shell}`,
      };
    }
    case "engineConfig": {
      const { key, value } = command;
      if (!["language", "max_tokens", "effort"].includes(key)) throw new ReviewError("failed");
      if (value === undefined) {
        if (key !== "max_tokens" && key !== "effort") throw new ReviewError("failed");
        return { args: ["config", "unset", key] };
      }
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 128 ||
        /[\0\r\n]/u.test(value) ||
        value.startsWith("-")
      ) {
        throw new ReviewError("failed");
      }
      return { args: ["config", "set", key, value] };
    }
    case "help": {
      if (!HELP.has(command.command)) throw new ReviewError("failed");
      return { args: [command.command, "--help"] };
    }
    case "version":
      return { args: ["version"] };
    case "providers":
      return { args: ["llm", "providers"] };
    default:
      throw new ReviewError("failed");
  }
}
