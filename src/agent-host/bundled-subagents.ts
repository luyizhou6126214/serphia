import {
  getAgentDir,
  type InlineExtension,
  type ModelRuntime,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import manifest from "../../package.json";
import type { SessionToolPolicy } from "./session-tool-policy";
import type { SubagentActivity } from "./subagent-activity";

export const bundledSubagents = {
  name: "pi-subagents",
  source: "builtin:pi-subagents",
  packageName: "@gotgenes/pi-subagents",
  version: manifest.dependencies["@gotgenes/pi-subagents"],
} as const;

export async function setBundledSubagentsEnabled(settings: SettingsManager, enabled: boolean): Promise<void> {
  const source = bundledSubagents.source;
  const paths = (settings.getGlobalSettings().extensions ?? []).filter(
    (entry) => ![source, `+${source}`, `-${source}`, `!${source}`].includes(entry),
  );
  settings.setExtensionPaths([...paths, `${enabled ? "+" : "-"}${source}`]);
  await settings.flush();
}

export function createBundledSubagentsExtension(
  cwd: string,
  settings: SettingsManager,
  policy: Pick<SessionToolPolicy, "delegatedCodingTools">,
  modelRuntime: ModelRuntime,
  activity: SubagentActivity,
): InlineExtension {
  return {
    name: bundledSubagents.name,
    builtin: true,
    replaceable: true,
    factory: async (pi) => {
      const { default: subagents } = await import("./upstream-subagents");
      activity.bind(pi);
      subagents(
        new Proxy(pi, {
          get(target, key, receiver) {
            if (key === "registerCommand") {
              // The upstream transcript viewer needs Pi's full terminal and theme objects.
              return (name: string, command: Parameters<typeof pi.registerCommand>[1]) => {
                if (name !== "subagents:sessions") target.registerCommand(name, command);
              };
            }
            return Reflect.get(target, key, receiver);
          },
        }),
        {
          cwd,
          modelRuntime,
          projectCwd: () => (settings.isProjectTrusted() ? cwd : getAgentDir()),
          isProjectTrusted: () => settings.isProjectTrusted(),
          childTools: (names) => policy.delegatedCodingTools(names),
        },
      );
    },
  };
}
