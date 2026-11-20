import {
  createAgentSessionServices,
  getAgentDir,
  SettingsManager,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { ensureAzureUpgrade } from "./azure-upgrade";
import { createDesktopModelRuntime } from "./model-credentials";
import { createAutoRoutingExtension } from "./auto-routing";
import { ensureProviderRenameSettings } from "./provider-renames";
import { createBundledSubagentsExtension } from "./bundled-subagents";
import type { SessionToolPolicy } from "./session-tool-policy";
import { SubagentActivity } from "./subagent-activity";

export async function createDesktopAgentSessionServices(
  options: NonNullable<Parameters<typeof createAgentSessionServices>[0]>,
  migration: { project?: boolean; sessionManager?: SessionManager; toolPolicy?: SessionToolPolicy } = {},
) {
  const azureUpgrade = await ensureAzureUpgrade({
    agentDir: options.agentDir,
    cwd: migration.project ? options.cwd : undefined,
    projectTrusted: options.settingsManager?.isProjectTrusted() ?? true,
  });
  const agentDir = options.agentDir ?? getAgentDir();
  await ensureProviderRenameSettings(agentDir);
  const modelRuntime =
    options.modelRuntime ??
    (await createDesktopModelRuntime({
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"),
      signal: options.modelRuntimeSignal,
    }));
  const sessionManager = migration.sessionManager;
  const toolPolicy = migration.project ? migration.toolPolicy : undefined;
  const settingsManager =
    options.settingsManager ?? (toolPolicy ? SettingsManager.create(options.cwd, agentDir) : undefined);
  const subagentActivity = toolPolicy ? new SubagentActivity() : undefined;
  const services = await createAgentSessionServices({
    ...options,
    settingsManager,
    modelRuntime,
    resourceLoaderOptions: {
      ...options.resourceLoaderOptions,
      extensionFactories: [
        createAutoRoutingExtension(
          agentDir,
          sessionManager
            ? (provider, model, usage) => {
                sessionManager.appendUsage("auto-routing", provider, model, usage);
              }
            : undefined,
        ),
        ...(options.resourceLoaderOptions?.extensionFactories ?? []),
        ...(toolPolicy && settingsManager && subagentActivity
          ? [createBundledSubagentsExtension(options.cwd, settingsManager, toolPolicy, modelRuntime, subagentActivity)]
          : []),
      ],
    },
  });
  if (await ensureProviderRenameSettings(agentDir, options.cwd, services.settingsManager.isProjectTrusted()))
    await services.settingsManager.reload();
  return { ...services, azureUpgrade, agentDir, subagentActivity };
}
