import { randomUUID } from "node:crypto";
import type { SuperAgentCli } from "../../contract/superagent";
import { startLocalAgent, type LocalAgentCommand } from "./process";
import { codexFileEdit, fileEdit, type AgentApprovalRequest } from "./permissions";
import { array, JsonLinePeer, object, replySchema, string, type JsonObject } from "./protocol";

export interface TurnOptions {
  cli: SuperAgentCli;
  command: LocalAgentCommand;
  cwd: string;
  prompt: string;
  sessionId?: string;
  outputSchema?: JsonObject;
  signal: AbortSignal;
  session(id: string): void;
  approval(request: AgentApprovalRequest): Promise<string | undefined>;
}

const approvalOptions = [
  { id: "allow", label: "Allow once" },
  { id: "deny", label: "Deny" },
];
const messageLimit = 65_536;

function withPeer<T>(options: TurnOptions, args: string[], execute: (peer: JsonLinePeer) => Promise<T>): Promise<T> {
  options.signal.throwIfAborted();
  const peer = new JsonLinePeer(startLocalAgent(options.command, args, options.cwd));
  const cancel = () => {
    void peer.close();
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  return peer.ready
    .then(() => {
      options.signal.throwIfAborted();
      return execute(peer);
    })
    .finally(async () => {
      options.signal.removeEventListener("abort", cancel);
      await peer.close();
    });
}

function settle<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { resolve, reject, promise };
}

function respond<T>(peer: JsonLinePeer, choice: Promise<T>, send: (choice: T) => void): void {
  void choice.then(send).catch((error: Error) => peer.onFailure(error));
}

function claude(options: TurnOptions): Promise<unknown> {
  const sessionId = options.sessionId ?? randomUUID();
  return withPeer(
    options,
    [
      "-p",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "default",
      "--permission-prompt-tool",
      "stdio",
      "--json-schema",
      JSON.stringify(options.outputSchema ?? replySchema),
      options.sessionId ? "--resume" : "--session-id",
      sessionId,
    ],
    (peer) => {
      const result = settle<unknown>();
      peer.onFailure = result.reject;
      peer.onMessage = (event) => {
        if (event.type === "system" && event.subtype === "init") options.session(string(event.session_id) || sessionId);
        if (event.type === "result") {
          if (event.is_error || event.subtype !== "success") {
            result.reject(
              new Error(
                string(event.result) || array(event.errors).map(string).join("\n") || "Claude Code turn failed",
              ),
            );
          } else {
            options.session(string(event.session_id) || sessionId);
            result.resolve(event.structured_output ?? event.result);
          }
        }
        if (event.type !== "control_request") return;
        const request = object(event.request);
        const send = (response: JsonObject) =>
          peer.send({
            type: "control_response",
            response: { subtype: "success", request_id: event.request_id, response },
          });
        if (request.subtype !== "can_use_tool") {
          peer.send({
            type: "control_response",
            response: { subtype: "error", request_id: event.request_id, error: "Unsupported permission request" },
          });
          return;
        }
        const tool = string(request.tool_name);
        respond(
          peer,
          options.approval({
            title: tool || "Claude Code permission",
            detail: JSON.stringify(request.input ?? "").slice(0, 4_000),
            options: approvalOptions,
            workspaceEdit: ["Edit", "Write", "MultiEdit"].includes(tool)
              ? fileEdit(object(request.input).file_path)
              : undefined,
          }),
          (answer) =>
            send(
              answer === "allow"
                ? { behavior: "allow", updatedInput: request.input }
                : { behavior: "deny", message: "The user declined this request." },
            ),
        );
      };
      peer.send({ type: "control_request", request_id: randomUUID(), request: { subtype: "initialize" } });
      peer.send({
        type: "user",
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: "user", content: options.prompt },
      });
      return result.promise;
    },
  );
}

function codex(options: TurnOptions): Promise<unknown> {
  return withPeer(options, ["app-server", "--stdio"], async (peer) => {
    await peer.request("initialize", { clientInfo: { name: "serphia", title: "Serphia", version: "1.0.0" } });
    peer.send({ method: "initialized" });
    const [catalog, config] = await Promise.all([
      peer.request("model/list", { limit: 100 }),
      peer.request("config/read", { includeLayers: false, cwd: options.cwd }),
    ]);
    const models = array(catalog.data).map(object);
    const configured = string(object(config.config).model);
    const fallback = string(models.find((model) => model.isDefault === true)?.model);
    const model = models.some((model) => model.model === configured) ? configured : fallback;
    const response = await peer.request(options.sessionId ? "thread/resume" : "thread/start", {
      cwd: options.cwd,
      ...(model ? { model } : {}),
      ...(options.sessionId ? { threadId: options.sessionId } : {}),
    });
    const threadId = string(object(response.thread).id);
    if (!threadId) throw new Error("Codex did not return a thread ID");
    options.session(threadId);
    let output = "";
    const pendingItems = new Map<string, JsonObject>();
    const result = settle<unknown>();
    peer.onFailure = result.reject;
    peer.onMessage = (event) => {
      const params = object(event.params);
      if (params.threadId && params.threadId !== threadId) return;
      if (event.method === "item/started") {
        const item = object(params.item);
        if (item.type === "fileChange" || item.type === "commandExecution") pendingItems.set(string(item.id), item);
      }
      if (event.method === "item/completed") {
        const item = object(params.item);
        pendingItems.delete(string(item.id));
        if (item.type === "agentMessage") output = string(item.text).slice(0, messageLimit);
      }
      if (event.method === "turn/completed") {
        const turn = object(params.turn);
        if (turn.status === "completed") result.resolve(output);
        else
          result.reject(
            new Error(string(object(turn.error).message) || `Codex turn ${string(turn.status) || "failed"}`),
          );
      }
      if (typeof event.id !== "string" && typeof event.id !== "number") return;
      const reply = (value: JsonObject) => peer.send({ id: event.id, result: value });
      if (
        event.method === "item/commandExecution/requestApproval" ||
        event.method === "item/fileChange/requestApproval"
      ) {
        const item = pendingItems.get(string(params.itemId));
        const fileChange = event.method === "item/fileChange/requestApproval";
        const location = string(params.grantRoot ?? params.cwd ?? item?.cwd);
        const proposed = fileChange
          ? array(item?.changes)
              .map(object)
              .map((change) => `${string(change.path)}\n${string(change.diff)}`)
              .join("\n")
          : string(params.command ?? item?.command);
        const network = object(params.networkApprovalContext);
        respond(
          peer,
          options.approval({
            title: network.host ? "Codex network access" : fileChange ? "Codex file changes" : "Codex command",
            detail: [proposed, string(network.host), location, string(params.reason)]
              .filter(Boolean)
              .join("\n")
              .slice(0, 4_000),
            options: approvalOptions,
            workspaceEdit: fileChange ? codexFileEdit(params, item ?? {}) : undefined,
          }),
          (answer) => reply({ decision: answer === "allow" ? "accept" : "decline" }),
        );
      } else if (event.method === "item/permissions/requestApproval") {
        const permissions = object(params.permissions);
        respond(
          peer,
          options.approval({
            title: "Codex additional permissions",
            detail: [string(params.reason), JSON.stringify(permissions)].filter(Boolean).join("\n").slice(0, 4_000),
            options: approvalOptions,
          }),
          (answer) => reply({ permissions: answer === "allow" ? permissions : {}, scope: "turn" }),
        );
      } else {
        peer.send({ id: event.id, error: { code: -32601, message: "Unsupported Codex request in SuperAgent" } });
      }
    };
    // Observe both promises immediately: a CLI can emit a failure or completion before acknowledging turn/start.
    const [reply] = await Promise.all([
      result.promise,
      peer.request("turn/start", {
        threadId,
        input: [{ type: "text", text: options.prompt }],
        outputSchema: options.outputSchema ?? replySchema,
      }),
    ]);
    return reply;
  });
}

function deepSeek(options: TurnOptions): Promise<unknown> {
  return withPeer(options, ["--profile", "acp"], async (peer) => {
    const init = await peer.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "serphia", version: "1.0.0" },
    });
    if (init.protocolVersion !== 1) throw new Error("Unsupported DeepSeek Harness ACP protocol version");
    const capabilities = object(init.agentCapabilities);
    const initial = { cwd: options.cwd, mcpServers: [] };
    let sessionId = options.sessionId;
    if (sessionId) {
      const method = object(capabilities.sessionCapabilities).resume ? "session/resume" : "session/load";
      if (method === "session/load" && !capabilities.loadSession)
        throw new Error("DeepSeek Harness cannot resume this session");
      await peer.request(method, { ...initial, sessionId });
    } else {
      sessionId = string((await peer.request("session/new", initial)).sessionId);
    }
    if (!sessionId) throw new Error("DeepSeek Harness did not return a session ID");
    options.session(sessionId);
    let output = "";
    const toolCalls = new Map<string, JsonObject>();
    peer.onMessage = (event) => {
      const params = object(event.params);
      if (params.sessionId !== sessionId) return;
      if (event.method === "session/update") {
        const update = object(params.update);
        if (update.sessionUpdate === "agent_message_chunk") {
          output = (output + string(object(update.content).text)).slice(-messageLimit);
        } else if (update.sessionUpdate === "tool_call" && typeof update.toolCallId === "string") {
          toolCalls.set(update.toolCallId, update);
        } else if (
          update.sessionUpdate === "tool_call_update" &&
          ["completed", "failed"].includes(string(update.status))
        ) {
          toolCalls.delete(string(update.toolCallId));
        }
      }
      if (event.method === "session/request_permission") {
        const optionsFromCli = array(params.options)
          .map(object)
          .filter((option) => option.kind === "allow_once" || option.kind === "reject_once");
        const request = object(params.toolCall);
        const latest = toolCalls.get(string(request.toolCallId));
        const tool = string(latest?.title);
        const rawInput = latest?.rawInput ?? request.rawInput;
        const allow = string(optionsFromCli.find((option) => option.kind === "allow_once")?.optionId);
        respond(
          peer,
          options.approval({
            title: tool || string(request.title) || "DeepSeek Harness permission",
            detail: JSON.stringify(rawInput ?? request.locations ?? "").slice(0, 4_000),
            options: optionsFromCli.map((option) => ({ id: string(option.optionId), label: string(option.name) })),
            workspaceEdit: ["edit", "write"].includes(tool) ? fileEdit(object(rawInput).file_path, allow) : undefined,
          }),
          (answer) =>
            peer.send({
              jsonrpc: "2.0",
              id: event.id,
              result: {
                outcome: answer ? { outcome: "selected", optionId: answer } : { outcome: "cancelled" },
              },
            }),
        );
      }
    };
    const result = await peer.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: options.prompt }],
    });
    if (result.stopReason !== "end_turn")
      throw new Error(`DeepSeek Harness turn ended: ${string(result.stopReason) || "unknown"}`);
    return output;
  });
}

export function runLocalAgentTurn(options: TurnOptions): Promise<unknown> {
  switch (options.cli) {
    case "claude":
      return claude(options);
    case "codex":
      return codex(options);
    case "dsh":
      return deepSeek(options);
  }
}
