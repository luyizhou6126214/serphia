import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  getSupportedThinkingLevels,
  type AssistantMessage,
  type Context,
  type Message,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Agent } from "undici";
import type { ReviewModelSelection } from "../../contract/code-review";
import { THINKING_LEVELS } from "../../shared/thinking-levels";
import { createDesktopAgentSessionServices } from "../desktop-session-services";
import { issueFromDiagnostics, ReviewError } from "./output";
import type { ReviewActivityLog } from "./activity";

type Services = Awaited<ReturnType<typeof createDesktopAgentSessionServices>>;
type Model = NonNullable<ReturnType<Services["modelRuntime"]["getModel"]>>;
type WireTool = { id: string; function: { name: string; arguments: string } };
type WireMessage = {
  role: string;
  content?: string | null;
  tool_calls?: WireTool[];
  tool_call_id?: string;
  name?: string;
};
type WireRequest = {
  messages: WireMessage[];
  tools?: { type: string; function: { name: string; description?: string; parameters?: Record<string, unknown> } }[];
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
};

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const PROVIDER_FETCH_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "mistral-conversations",
  "pi-messages",
]);

function activityUsage(usage: AssistantMessage["usage"]) {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (inputTokens === 0 && usage.output === 0) return undefined;
  return {
    inputTokens,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
  };
}

export async function resolveReviewModel(cwd: string, selection: ReviewModelSelection) {
  if (
    !selection ||
    typeof selection.provider !== "string" ||
    typeof selection.modelId !== "string" ||
    selection.provider.length > 256 ||
    selection.modelId.length > 512 ||
    (selection.thinking !== "auto" && !THINKING_LEVELS.includes(selection.thinking))
  ) {
    throw new ReviewError("profile");
  }
  const services = await createDesktopAgentSessionServices({ cwd });
  const model = services.modelRuntime.getModel(selection.provider, selection.modelId);
  if (
    !model ||
    !(await services.modelRuntime.getAvailable(selection.provider)).some((available) => available.id === model.id)
  ) {
    throw new ReviewError("profile");
  }
  const supported = getSupportedThinkingLevels(model);
  if (selection.thinking !== "auto" && !supported.includes(selection.thinking)) throw new ReviewError("profile");
  const level = selection.thinking === "auto" ? services.settingsManager.getDefaultThinkingLevel() : selection.thinking;
  const reasoning = level && level !== "off" && supported.includes(level) ? level : undefined;
  return { runtime: services.modelRuntime, model, reasoning };
}

function toContext(request: WireRequest, model: Model, assistantCache: Map<string, AssistantMessage>): Context {
  if (!Array.isArray(request.messages)) throw new Error("Missing messages");
  const names = new Map<string, string>();
  const messages = request.messages.map((message): Message => {
    const timestamp = Date.now();
    const content = message.content ?? "";
    if (typeof content !== "string") throw new Error("Invalid message content");
    if (message.role === "user" || message.role === "system" || message.role === "developer") {
      return { role: message.role === "developer" ? "system" : message.role, content, timestamp };
    }
    if (message.role === "tool" && message.tool_call_id) {
      return {
        role: "toolResult",
        toolCallId: message.tool_call_id,
        toolName: names.get(message.tool_call_id) ?? message.name ?? "tool",
        content: [{ type: "text", text: content }],
        isError: false,
        timestamp,
      };
    }
    if (message.role !== "assistant") throw new Error("Invalid message role");
    const calls = (message.tool_calls ?? []).map((call): ToolCall => {
      names.set(call.id, call.function.name);
      const args: ToolCall["arguments"] = JSON.parse(call.function.arguments || "{}");
      return { type: "toolCall", id: call.id, name: call.function.name, arguments: args };
    });
    const cached = calls.length ? assistantCache.get(calls[0].id) : undefined;
    if (cached) return cached;
    return {
      role: "assistant",
      timestamp,
      model: model.id,
      api: model.api,
      provider: model.provider,
      content: [...(content ? [{ type: "text" as const, text: content }] : []), ...calls],
      stopReason: calls.length ? "toolUse" : "stop",
      usage: ZERO_USAGE,
    };
  });
  const tools = request.tools?.map(({ function: tool }) => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: Type.Unsafe(tool.parameters ?? { type: "object" }),
  }));
  return { messages, tools };
}

async function readRequest(req: IncomingMessage): Promise<WireRequest> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.length;
    if (length > 16 * 1024 * 1024) throw new Error("Request exceeds review limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as WireRequest;
}

function writeResponse(res: ServerResponse, request: WireRequest, assistant: AssistantMessage) {
  const calls = assistant.content.filter((block) => block.type === "toolCall");
  const text = assistant.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const message = {
    role: "assistant",
    content: text || null,
    ...(calls.length
      ? {
          tool_calls: calls.map((call, index) => ({
            ...(request.stream ? { index } : {}),
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }
      : {}),
  };
  const usage = {
    prompt_tokens: assistant.usage.input + assistant.usage.cacheRead + assistant.usage.cacheWrite,
    completion_tokens: assistant.usage.output,
    total_tokens: assistant.usage.totalTokens,
    prompt_tokens_details: { cached_tokens: assistant.usage.cacheRead },
  };
  const finish = calls.length ? "tool_calls" : assistant.stopReason === "length" ? "length" : "stop";
  const common = { id: `chatcmpl-${randomUUID()}`, model: assistant.model, created: Math.floor(Date.now() / 1000) };
  if (request.stream) {
    const base = { ...common, object: "chat.completion.chunk" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const events = [
      { ...base, choices: [{ index: 0, delta: message, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
      { ...base, choices: [], usage },
    ];
    res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ...common,
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason: finish }],
        usage,
      }),
    );
  }
  return calls;
}

/** OCR keeps its review pipeline. This private transport forwards its model calls through Pi. */
export async function withReviewGateway<T>(
  provider: Awaited<ReturnType<typeof resolveReviewModel>>,
  signal: AbortSignal,
  operation: (gateway: { env: Record<string, string>; token: string }) => Promise<T>,
  activity?: ReviewActivityLog,
) {
  signal.throwIfAborted();
  const token = randomUUID();
  activity?.setGatewayToken(token);
  const sessionId = randomUUID();
  const cache = new Map<string, AssistantMessage>();
  const { runtime, model, reasoning } = provider;
  const dispatcher = PROVIDER_FETCH_APIS.has(model.api)
    ? new Agent({ connect: { timeout: 0 }, headersTimeout: 0, bodyTimeout: 0 })
    : undefined;
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    if (
      req.method !== "POST" ||
      req.url !== "/v1/chat/completions" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.writeHead(401).end();
      return;
    }
    const disconnected = new AbortController();
    res.once("close", () => disconnected.abort());
    let row: number | undefined;
    let diagnostic: string | undefined;
    let usage: ReturnType<typeof activityUsage>;
    try {
      const request = await readRequest(req);
      const context = toContext(request, model, cache);
      for (const message of request.messages) {
        if (message.role === "tool" && message.tool_call_id && typeof message.content === "string") {
          activity?.forwardedToolResult(message.tool_call_id, message.content);
        }
      }
      row = activity?.beginModel(model.name, model.provider);
      const requested = request.max_completion_tokens ?? request.max_tokens;
      const maxTokens =
        requested && Number.isSafeInteger(requested) && requested > 0
          ? Math.min(requested, model.maxTokens || requested)
          : undefined;
      const requestSignal = AbortSignal.any([signal, disconnected.signal]);
      const fetchOptions = { dispatcher } as RequestInit;
      let contextWindow = model.contextWindow;
      const stream = runtime.streamSimple(model, context, {
        maxTokens,
        reasoning,
        sessionId,
        signal: requestSignal,
        timeoutMs: dispatcher ? 0 : undefined,
        maxRetryDelayMs: 0,
        websocketConnectTimeoutMs: model.api === "openai-codex-responses" ? 0 : undefined,
        fetch: dispatcher ? (input, init) => fetch(input, { ...init, ...fetchOptions }) : undefined,
        onResponse: (_response, respondingModel) => {
          contextWindow = respondingModel.contextWindow;
        },
      });
      for await (const event of stream) {
        if (row !== undefined && (event.type === "text_delta" || event.type === "thinking_delta")) {
          activity?.delta(row, event.type === "text_delta" ? "text" : "reasoning", event.delta);
        }
      }
      const answer = await stream.result();
      usage = activityUsage(answer.usage);
      if (answer.stopReason === "error" || answer.stopReason === "aborted" || answer.stopReason === "deferred") {
        diagnostic = answer.errorMessage;
        throw new ReviewError(issueFromDiagnostics(answer.errorMessage ?? ""));
      }
      if (row !== undefined)
        activity?.finishModel(row, {
          status: "done",
          model: answer.model === model.id ? model.name : answer.model,
          provider: answer.provider,
          text: answer.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
          reasoning: answer.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : [])).join(""),
          ...usage,
          contextWindow: runtime.getModel(answer.provider, answer.model)?.contextWindow ?? contextWindow,
          toolUse: answer.content.some((block) => block.type === "toolCall"),
        });
      if (res.destroyed) return;
      for (const call of writeResponse(res, request, answer)) {
        activity?.beginTool(call.id, call.name, JSON.stringify(call.arguments));
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(call.id, answer);
      }
    } catch (error) {
      const issue =
        error instanceof ReviewError ? error.issue : issueFromDiagnostics(error instanceof Error ? error.message : "");
      if (row !== undefined)
        activity?.finishModel(row, {
          status: "error",
          ...usage,
          issue,
          diagnostic:
            diagnostic ?? (error instanceof Error && !(error instanceof ReviewError) ? error.message : undefined),
        });
      if (res.destroyed) return;
      const status = issue === "authentication" ? 401 : issue === "rateLimit" ? 429 : issue === "timeout" ? 408 : 502;
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: issue } }));
    }
  };
  const server = createServer({ requestTimeout: 0, headersTimeout: 0 }, (req, res) => void serve(req, res));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new ReviewError("failed");
    return await operation({
      token,
      env: {
        OCR_LLM_URL: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        OCR_LLM_PROTOCOL: "openai",
        OCR_LLM_MODEL: model.id,
        OCR_LLM_TOKEN: token,
        OCR_LLM_TIMEOUT: "0",
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dispatcher?.destroy();
  }
}
