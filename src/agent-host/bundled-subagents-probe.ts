import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { setBundledSubagentsEnabled } from "./bundled-subagents";
import { createDesktopAgentSessionServices } from "./desktop-session-services";
import { SessionToolPolicy } from "./session-tool-policy";
import { setAgentSessionSource } from "./session-source";
import type { SubagentActivityItem } from "../shared/types";

const subagentTools = ["subagent", "get_subagent_result", "steer_subagent"];
const expected = "PACKAGED_SUBAGENT_READ";

/** Uses the real plugin and child session with a deterministic, network-free model stream. */
export async function probeBundledSubagents(runtime: ModelRuntime): Promise<true> {
  const root = await mkdtemp(path.join(tmpdir(), "serphia-subagents-"));
  const originalStream = runtime.streamSimple;
  const virtualId = "serphia-offline-subagents";
  let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
  try {
    const settings = SettingsManager.create(root, root);
    const sessionManager = SessionManager.create(root, path.join(root, "sessions"));
    const policy = new SessionToolPolicy(sessionManager, ["read"]);
    setAgentSessionSource(sessionManager, "local");
    const services = await createDesktopAgentSessionServices(
      {
        cwd: root,
        agentDir: root,
        modelRuntime: runtime,
        settingsManager: settings,
        resourceLoaderOptions: { noSkills: true, noContextFiles: true },
      },
      { project: true, sessionManager, toolPolicy: policy },
    );
    const errors = services.resourceLoader.getExtensions().errors;
    if (errors.length) throw new Error(`Bundled subagents failed to load: ${JSON.stringify(errors)}`);
    await runtime.setRuntimeApiKey("anthropic", "offline-subagents-probe");
    const physicalModel = runtime.getModel("anthropic", "claude-sonnet-5-5");
    if (!physicalModel) throw new Error("Packaged subagent fixture model is missing");
    runtime.registerVirtualModel({
      provider: "anthropic",
      id: virtualId,
      name: "Offline Subagent Probe",
      route: () => ({ model: physicalModel, thinkingLevel: "off" }),
    });
    ({ session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      model: runtime.getModel("anthropic", virtualId),
      tools: ["read", ...subagentTools],
    }));
    policy.bind(session);
    await session.bindExtensions({ mode: "rpc" });
    const activitySnapshots: SubagentActivityItem[][] = [];
    services.subagentActivity?.subscribe((items) => activitySnapshots.push(items));

    const hasTool = (name: string) => session!.getAllTools().some((tool) => tool.name === name);
    if (!subagentTools.every(hasTool)) throw new Error("Bundled subagent tools were not registered");
    await writeFile(path.join(root, "fixture.txt"), expected);
    runtime.streamSimple = (model, context) => {
      if (model.id !== physicalModel.id) throw new Error("Subagent lost the parent's virtual model route");
      const tools = context.messages.flatMap((message) =>
        message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
      );
      if (!tools.includes("read") || tools.some((name) => !["read", "ask_parent", "notify_parent"].includes(name))) {
        throw new Error(`Unexpected delegated tools: ${tools.join(", ")}`);
      }
      const result = context.messages.find((message) => message.role === "toolResult" && message.toolName === "read");
      return mockStream(
        model,
        result
          ? [{ type: "text", text: JSON.stringify(result.content).includes(expected) ? expected : "fixture missing" }]
          : [{ type: "toolCall", id: "child-read", name: "read", arguments: { path: "fixture.txt" } }],
      );
    };
    const calls = Array.from({ length: 4 }, (_, index) => ({
      type: "toolCall" as const,
      id: `parent-subagent-${index}`,
      name: "subagent",
      arguments: {
        prompt: "Read fixture.txt",
        description: `Read bundled fixture ${index + 1}`,
        subagent_type: "general-purpose",
        run_in_background: false,
      },
    }));
    let parentCalls = 0;
    session.agent.streamFunction = (model) =>
      mockStream(model, ++parentCalls === 1 ? calls : [{ type: "text", text: "Done" }]);
    await session.prompt("Run four bundled subagents", { source: "rpc" });
    const results = session.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "subagent",
    );
    if (
      results.length !== calls.length ||
      results.some(
        (result) =>
          result.role !== "toolResult" || result.isError || !JSON.stringify(result.content).includes(expected),
      )
    ) {
      throw new Error(`Bundled subagent round trip failed: ${JSON.stringify(results)}`);
    }
    if (
      !activitySnapshots.some((items) => items.filter((item) => item.status === "running").length > 1) ||
      !activitySnapshots.some(
        (items) => items.length === calls.length && items.every((item) => item.status === "completed"),
      ) ||
      activitySnapshots.at(-1)?.length !== 0
    ) {
      throw new Error("Bundled subagent activity did not track parallel execution and clear when the parent finished");
    }
    await setBundledSubagentsEnabled(settings, false);
    await session.reload();
    if (subagentTools.some(hasTool)) throw new Error("Disabled bundled subagent tools are still registered");
    await setBundledSubagentsEnabled(settings, true);
    await session.reload();
    if (!subagentTools.every(hasTool)) throw new Error("Re-enabled bundled subagent tools are missing");
    return true;
  } finally {
    runtime.streamSimple = originalStream;
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    runtime.unregisterVirtualModel("anthropic", virtualId);
    await rm(root, { recursive: true, force: true });
  }
}

function mockStream(model: Model<Api>, content: AssistantMessage["content"]) {
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: content.some((entry) => entry.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
    stream.end();
  });
  return stream;
}
