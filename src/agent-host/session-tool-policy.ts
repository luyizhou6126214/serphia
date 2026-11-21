import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ToolInfo } from "../shared/pi-types";
import { excludedPiTools, filterDesktopToolNames } from "../shared/pi-tool-policy";
import { getAgentSessionSource } from "./session-source";
import { isHerdrToolName } from "./herdr/tool-names";
import { isManagedProcessToolName } from "./managed-process/tool-names";
import { CODING_TOOL_NAMES } from "./tool-activation";
import { isMcpManagedTool } from "../shared/mcp-tool-policy";
import { isOrchestrationTool } from "../shared/orchestration-tools";
import { requiresSessionDirectory } from "../shared/session-workspace";
import { DESKTOP_WINDOW_PROTOTYPE_TOOL } from "../contract/desktop-window-prototype";

/** A Desktop grant is independent from SDK declaration/callable membership. */
export class SessionToolPolicy {
  private session?: AgentSessionLike;
  private initialActive = new Set<string>();
  private availability?: (name: string) => boolean;
  private resourceReady?: () => boolean;

  setResourceReady(check: () => boolean): void {
    this.resourceReady = check;
  }
  setAvailability(check: (name: string) => boolean): void {
    this.availability = check;
  }
  private mcpIdentityGuard?: (name: string) => boolean;
  private mcpPreparation?: (name: string, input: unknown, ctx: ExtensionContext, callId: string) => Promise<void>;
  setMcpPreparation(prepare: NonNullable<SessionToolPolicy["mcpPreparation"]>): void {
    this.mcpPreparation = prepare;
  }
  setMcpIdentityGuard(guard: (name: string) => boolean): void {
    this.mcpIdentityGuard = guard;
  }
  private mcpAuthorizer?: (
    name: string,
    input: unknown,
    ctx: ExtensionContext,
    valid: () => boolean,
  ) => Promise<boolean>;
  setMcpAuthorizer(authorizer: typeof this.mcpAuthorizer): void {
    this.mcpAuthorizer = authorizer;
  }
  constructor(
    private readonly manager: object,
    private requested?: string[],
    private execution?: string[],
    private mcpExecution?: string[],
    private readonly platform: string = process.platform,
    private readonly hasDirectory = true,
  ) {}
  bind(session: AgentSessionLike): void {
    this.session = session;
    if (!this.requested?.includes("powershell") && session.getActiveToolNames().includes("powershell"))
      session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== "powershell"));
    this.initialActive = new Set(session.getActiveToolNames());
  }
  setRequested(names: string[]): void {
    const wasEmpty = this.requested?.length === 0;
    this.requested = [...names];
    if (names.length === 0) this.execution = [];
    else if (wasEmpty) this.execution = undefined;
    if (names.length === 0) this.mcpExecution = [];
    else if (wasEmpty) this.mcpExecution = undefined;
  }
  isEmpty(): boolean {
    return this.requested?.length === 0;
  }
  setMcpExecution(names: string[]): void {
    this.mcpExecution = [...names];
  }
  getMcpExecution(): string[] | undefined {
    return this.mcpExecution ? [...this.mcpExecution] : undefined;
  }
  setExecution(names: string[]): void {
    this.execution = filterDesktopToolNames(names, this.platform);
    this.mcpExecution = undefined;
  }
  getExecution(): string[] | undefined {
    return this.execution ? [...this.execution] : undefined;
  }
  delegatedCodingTools(names: readonly string[]): ToolDefinition[] {
    const isAllowed = (name: string) =>
      getAgentSessionSource(this.manager) === "local" && CODING_TOOL_NAMES.has(name) && this.isAllowed(name);
    return names.flatMap((name) => {
      if (!isAllowed(name)) return [];
      const tool = this.session?.getToolDefinition?.(name);
      if (!tool) return [];
      return [
        {
          ...tool,
          execute: (...args: Parameters<ToolDefinition["execute"]>) => {
            if (!isAllowed(name))
              throw new Error(`TOOL_PERMISSION_DENIED: ${name} is not authorized for this session/source`);
            return tool.execute(...args);
          },
        },
      ];
    });
  }
  isAllowed(name: string): boolean {
    if (!this.hasDirectory && requiresSessionDirectory(name)) return false;
    if (this.resourceReady && !this.resourceReady()) return false;
    if (!this.session || this.requested?.length === 0 || excludedPiTools(this.platform).includes(name)) return false;
    if (name === "powershell" && !this.requested?.includes(name)) return false;
    const source = getAgentSessionSource(this.manager);
    if (source === "unknown") return false;
    if (name === DESKTOP_WINDOW_PROTOTYPE_TOOL && source !== "local") return false;
    if (source === "channel" && (isHerdrToolName(name) || isManagedProcessToolName(name))) return false;
    const tool =
      this.session.getToolDefinition?.(name) ?? this.session.getAllTools().find((entry) => entry.name === name);
    if (!tool || tool.exposure === "hidden") return false;
    if (source === "local" && isOrchestrationTool(name)) return this.session.getActiveToolNames().includes(name);
    if (isOrchestrationTool(name))
      return (
        (this.mcpExecution ?? this.execution ?? this.requested)?.includes(name) === true &&
        this.session.getActiveToolNames().includes(name)
      );
    if (isMcpManagedTool(name)) {
      if (name.startsWith("mcp__") && this.mcpIdentityGuard && !this.mcpIdentityGuard(name)) return false;
      if (this.mcpExecution !== undefined) return this.mcpExecution.includes(name);
      if (this.execution !== undefined) return this.execution.includes(name);
      return this.requested?.includes(name) === true && this.session.getActiveToolNames().includes(name);
    }
    if (CODING_TOOL_NAMES.has(name))
      return (
        (this.requested ? this.requested.includes(name) : this.initialActive.has(name)) &&
        this.session.getActiveToolNames().includes(name)
      );
    if (this.execution !== undefined) return this.execution.includes(name);
    if (tool.exposure === "codemode" || tool.exposure === "deferred") return false;
    const explicit = this.requested?.includes(name) === true;
    return (
      this.session.getActiveToolNames().includes(name) &&
      (explicit || this.session.getToolDefinition?.(name)?.defaultActive !== false)
    );
  }

  private isSubagentLaunchAllowed(event: ToolCallEvent, pi: ExtensionAPI): boolean {
    if (
      event.toolName !== "subagent_launch" ||
      !event.parentToolCallId ||
      getAgentSessionSource(this.manager) !== "local" ||
      !this.isAllowed("subagent")
    )
      return false;

    // The installed Pi Subagents workflow uses a deferred call to run the
    // approval hooks. Only inherit permission from its own authorized call.
    const tools = pi.getAllTools();
    const parent = tools.find((tool) => tool.name === "subagent");
    const hook = tools.find((tool) => tool.name === event.toolName);
    if (
      parent?.exposure !== "model-only" ||
      hook?.exposure !== "deferred" ||
      !parent.sourceInfo?.path ||
      parent.sourceInfo.path !== hook.sourceInfo?.path
    )
      return false;

    const messages = this.session?.agent.state?.messages;
    return (
      messages?.some((value) => {
        const message = value as AssistantMessage;
        return (
          message.role === "assistant" &&
          message.content.some(
            (block) => block.type === "toolCall" && block.name === parent.name && block.id === event.parentToolCallId,
          )
        );
      }) === true
    );
  }
  describe(): ToolInfo[] {
    if (!this.session) return [];
    const active = new Set(this.session.getActiveToolNames());
    const callable = new Set(this.session.getCallableToolNames?.() ?? this.session.getActiveToolNames());
    return this.session
      .getAllTools()
      .filter((tool) => tool.exposure !== "hidden" && (this.hasDirectory || !requiresSessionDirectory(tool.name)))
      .map((tool) => ({
        // SDK metadata also contains functions and private extension paths. Only project the wire contract.
        name: tool.name,
        description: tool.description,
        ...(this.availability ? { available: this.availability(tool.name) } : {}),
        exposure: tool.exposure,
        ...(tool.namespace
          ? {
              namespace: {
                name: tool.namespace.name,
                aliases: tool.namespace.aliases ? [...tool.namespace.aliases] : undefined,
                description: tool.namespace.description,
                instructions: tool.namespace.instructions,
              },
            }
          : {}),
        ...(tool.annotations
          ? {
              annotations: {
                readOnlyHint: tool.annotations.readOnlyHint,
                destructiveHint: tool.annotations.destructiveHint,
                idempotentHint: tool.annotations.idempotentHint,
                openWorldHint: tool.annotations.openWorldHint,
              },
            }
          : {}),
        active: active.has(tool.name),
        callable: callable.has(tool.name),
        executionAllowed: this.isAllowed(tool.name),
      }));
  }
  extension() {
    return {
      name: "pi-desktop-tool-execution-policy",
      hidden: true,
      factory: (pi: ExtensionAPI) => {
        pi.on("tool_call", async (event, ctx) => {
          if (!this.isEmpty()) await this.mcpPreparation?.(event.toolName, event.input, ctx, event.toolCallId);
          if (this.isAllowed(event.toolName) || this.isSubagentLaunchAllowed(event, pi)) return;
          const tool = this.session?.getAllTools().find((entry) => entry.name === event.toolName);
          if (
            !this.isEmpty() &&
            getAgentSessionSource(this.manager) === "local" &&
            ctx.hasUI &&
            tool &&
            tool.exposure !== "hidden" &&
            isMcpManagedTool(event.toolName)
          ) {
            const approved = await this.mcpAuthorizer?.(
              event.toolName,
              event.input,
              ctx,
              () => !this.isEmpty() && getAgentSessionSource(this.manager) === "local",
            );
            if (approved && getAgentSessionSource(this.manager) === "local" && this.isAllowed(event.toolName)) return;
          }
          return {
            block: true,
            reason: `TOOL_PERMISSION_DENIED: ${event.toolName} is not authorized for this session/source`,
          };
        });
      },
    };
  }
}
