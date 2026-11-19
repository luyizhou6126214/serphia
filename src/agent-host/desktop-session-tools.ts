import {
  createBashToolDefinition,
  type CreateAgentSessionFromServicesOptions,
  type SessionManager,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { toolchainRuntime, type ToolchainRuntime } from "./toolchain-runtime";
import { createToolchainBashOptions } from "./toolchain-bash";
import { presentationWorkflowContext } from "./presentation-workflow-context";
import { createDesktopPowerShellTool } from "./toolchain-powershell";
import { codingToolAvailability } from "../shared/tool-presets";
import type { AgentSessionWrapper } from "./rpc-manager";
import type { SessionToolPolicy } from "./session-tool-policy";
import { createDesktopSearchToolDefinitions } from "./toolchain-search";
import { createBrowserToolDefinitions } from "./browser-tools";
import { desktopWindowPrototypeTools } from "./desktop-window-prototype-tool";
import { browserAgentRuntime } from "./browser-agent-runtime";
import { peekHerdrBridge } from "./herdr/runtime";
import { createHerdrToolDefinitions } from "./herdr/tools";
import { peekManagedProcessService } from "./managed-process/runtime";
import { createManagedProcessToolDefinitions } from "./managed-process/tools";
import type { SessionExecutionHistory } from "./session-execution-history";
import type { ToolExecutionContext } from "../shared/toolchains/types";
import type { AgentShell } from "../shared/agent-shell";

export async function createDesktopSessionTools(
  cwd: string,
  manager: SessionManager,
  settings: SettingsManager,
  history: SessionExecutionHistory,
  {
    runtime = toolchainRuntime,
    platform = process.platform,
    shell,
  }: { runtime?: ToolchainRuntime; platform?: NodeJS.Platform; shell?: AgentShell } = {},
) {
  if (!cwd) {
    return {
      customTools: [history.tool(), ...createBrowserToolDefinitions(), ...desktopWindowPrototypeTools(platform)],
      attach(_wrapper: AgentSessionWrapper, executionPolicy: SessionToolPolicy) {
        executionPolicy.setAvailability(() => true);
      },
    };
  }
  const resolve = () =>
    runtime.createExecutionContext({
      cwd,
      intent: "agent-shell",
      trusted: settings.isProjectTrusted(),
    });
  let executionContext = await resolve();
  let policy: SessionToolPolicy | undefined;
  const assertPowerShellAuthorized = () => {
    if (!policy?.isAllowed("powershell"))
      throw new Error("TOOL_PERMISSION_DENIED: powershell is not authorized for this session/source");
  };
  const definitions = (context: ToolExecutionContext) => {
    // A new Studio session gets its workflow entry after these tools are constructed.
    const sessionEnv = () => (presentationWorkflowContext(manager) ? { SERPHIA_PPT_STUDIO: "1" } : undefined);
    const guardCommand = (command: string) => browserAgentRuntime.guardBash(manager.getSessionId(), command);
    const bashOptions = createToolchainBashOptions(
      context,
      runtime,
      settings.getShellCommandPrefix(),
      guardCommand,
      sessionEnv,
    );
    return [
      history.tool(),
      createBashToolDefinition(cwd, bashOptions),
      ...(platform === "win32"
        ? [createDesktopPowerShellTool(cwd, context, runtime, guardCommand, assertPowerShellAuthorized, sessionEnv)]
        : []),
      ...createDesktopSearchToolDefinitions(cwd, context, runtime),
      ...createBrowserToolDefinitions(),
      ...desktopWindowPrototypeTools(platform),
      ...(peekHerdrBridge() ? [...createHerdrToolDefinitions(cwd, peekHerdrBridge()!)] : []),
      ...(peekManagedProcessService()
        ? createManagedProcessToolDefinitions(cwd, settings.isProjectTrusted(), peekManagedProcessService()!)
        : []),
    ] as ToolDefinition[];
  };
  let current = new Map(definitions(executionContext).map((tool) => [tool.name, tool]));
  // Each invocation captures its definition; reload replaces only future invocations' immutable context.
  const customTools = [...current.values()].map((tool) => ({
    ...tool,
    execute: (...args: Parameters<ToolDefinition["execute"]>) => current.get(tool.name)!.execute(...args),
  })) as NonNullable<CreateAgentSessionFromServicesOptions["customTools"]>;
  return {
    executionContext,
    customTools,
    attach(wrapper: AgentSessionWrapper, executionPolicy: SessionToolPolicy) {
      policy = executionPolicy;
      const publish = () => {
        wrapper.setToolchainSummary(executionContext.inventoryRevision, executionContext.summary);
        executionPolicy.setAvailability(
          (name) =>
            codingToolAvailability(platform, executionContext.commands, shell).find((tool) => tool.name === name)
              ?.available !== false,
        );
      };
      publish();
      wrapper.refreshToolchain = async () => {
        const nextContext = await resolve();
        const next = new Map(definitions(nextContext).map((tool) => [tool.name, tool]));
        executionContext = nextContext;
        current = next;
        publish();
      };
    },
  };
}
