// Adapted from pi-plan-mode-tidy (MIT). See THIRD_PARTY_NOTICES.md.
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { ExtensionUiContextLike } from "../shared/pi-types";
import {
  PLAN_MODE_COMMAND,
  PLAN_MODE_EXTENSION,
  PLAN_MODE_READ_ONLY,
  PLAN_MODE_STATUS,
  PLAN_REFINE_TITLE,
  PLAN_REVIEW_CHOICES,
  PLAN_REVIEW_TITLE,
  readPlanModeEnabled,
  type PlanModeAction,
} from "../shared/plan-mode";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const PLAN_REVIEW_TIMEOUT = 5 * 60_000;
const PLAN_INSTRUCTIONS = [
  "Plan mode is active. Explore using only the available read-only tools. Do not edit files, run shell commands, or implement the task.",
  "Ask the user in chat if a decision is needed before you can make a plan.",
  'When the plan is ready, write it in the language of the conversation under a standalone "Plan:", "计划：", or "計畫：" heading, followed by a numbered list.',
  "Include enough detail to implement and verify the changes. Stop after proposing the plan and wait for the user to approve execution.",
].join("\n");

function extractPlan(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let fence: string | undefined;
  let start = -1;
  let numbered = false;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence) && /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (start === -1) {
      if (
        /^ {0,3}(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:plan|计划|計畫|計劃)\s*[:：]?(?:\*\*|__)?\s*[:：]?\s*#*\s*$/i.test(line)
      )
        start = index;
      continue;
    }
    if (/^ {0,3}#{1,6}[ \t]+/.test(line)) return numbered ? lines.slice(start, index).join("\n").trim() : undefined;
    if (/^ {0,3}\d+(?:[.)][ \t]+|[、．）][ \t]*)\S/.test(line)) numbered = true;
  }
  return numbered ? lines.slice(start).join("\n").trim() : undefined;
}

export function createPlanModeExtension() {
  let change: ((action: PlanModeAction) => boolean) | undefined;
  return {
    name: PLAN_MODE_EXTENSION,
    changeMode(action: PlanModeAction): boolean {
      if (!change) throw new Error("Plan mode is unavailable for this session");
      return change(action);
    },
    factory(pi) {
      change = undefined;
      let enabled = false;
      let proposedPlan: string | undefined;
      let reviewing = false;

      function publishStatus(ctx: ExtensionContext): void {
        ctx.ui.setStatus(PLAN_MODE_STATUS, enabled ? PLAN_MODE_READ_ONLY : undefined);
      }

      function setEnabled(value: boolean, ctx: ExtensionContext): void {
        if (enabled !== value) {
          pi.appendEntry(PLAN_MODE_EXTENSION, { enabled: value });
          enabled = value;
        }
        publishStatus(ctx);
      }

      const canChange = (ctx: ExtensionContext) => !reviewing && ctx.isIdle();

      pi.registerCommand(PLAN_MODE_COMMAND, {
        description: "Toggle Plan mode for read-only exploration",
        async handler(_args, ctx) {
          if (!canChange(ctx)) {
            ctx.ui.notify("Wait for the current turn before changing Plan mode.", "warning");
            return;
          }
          setEnabled(!enabled, ctx);
        },
      });

      pi.on("session_start", (_event, ctx) => {
        enabled = readPlanModeEnabled(ctx.sessionManager.getEntries());
        change = (action) => {
          if (!canChange(ctx)) throw new Error("Wait for the current turn before changing Plan mode");
          setEnabled(action === "toggle" && !enabled, ctx);
          return enabled;
        };
        publishStatus(ctx);
      });

      pi.on("agent_start", () => {
        proposedPlan = undefined;
      });

      // Filter declarations on each model request without changing Desktop grants or the transcript's loadout.
      // A shell command can write through flags, startup configuration or a configured command prefix.
      pi.on("context_with_system", (event) => {
        if (!enabled) return;
        const messages = event.messages.map((message) => {
          if (message.role !== "system") return message;
          return {
            ...message,
            toolsAdded: message.toolsAdded?.filter(({ name }) => READ_ONLY_TOOLS.has(name)),
            toolsRemoved: message.toolsRemoved?.filter(({ name }) => READ_ONLY_TOOLS.has(name)),
          };
        });
        // Keep instructions request-local, including in sessions with an empty system prompt.
        messages.push({
          role: "custom",
          customType: PLAN_MODE_EXTENSION,
          content: PLAN_INSTRUCTIONS,
          display: false,
          timestamp: Date.now(),
        });
        return { messages };
      });

      // SDK callable tools can remain reachable even when they are absent from the model request.
      pi.on("tool_call", (event) => {
        if (enabled && !READ_ONLY_TOOLS.has(event.toolName)) {
          return { block: true, reason: `Plan mode allows only read-only exploration. ${event.toolName} is blocked.` };
        }
      });

      pi.on("agent_end", (event) => {
        if (!enabled) return;
        const reply = event.messages.findLast((message) => message.role === "assistant");
        proposedPlan =
          reply?.stopReason === "stop"
            ? extractPlan(reply.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"))
            : undefined;
      });

      pi.on("agent_settled", async (event, ctx) => {
        const plan = proposedPlan;
        proposedPlan = undefined;
        if (!plan || event.aborted || !enabled || !ctx.hasUI) return;
        reviewing = true;
        try {
          const options = { timeout: PLAN_REVIEW_TIMEOUT };
          const review: Parameters<ExtensionUiContextLike["select"]>[2] = { ...options, plan };
          const choice = await ctx.ui.select(PLAN_REVIEW_TITLE, Object.values(PLAN_REVIEW_CHOICES), review);
          if (choice === PLAN_REVIEW_CHOICES.refine) {
            const refinement = (await ctx.ui.input(PLAN_REFINE_TITLE, "", options))?.trim();
            if (refinement) pi.sendUserMessage(refinement);
          } else if (choice === PLAN_REVIEW_CHOICES.execute) {
            setEnabled(false, ctx);
            pi.sendUserMessage(
              `Execute the approved plan below. Continue in the language of the conversation.\n\n${plan}`,
            );
          }
        } finally {
          reviewing = false;
        }
      });
    },
  } satisfies InlineExtension & { changeMode(action: PlanModeAction): boolean };
}
