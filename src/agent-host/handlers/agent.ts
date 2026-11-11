import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ApiHandler, RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { isAgentCommand } from "../../contract/agent-commands";
import { getRpcSession, startRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import { readSessionSnapshot } from "../session-readonly";
import { allowFileRoot } from "../file-access";
import { emitIndexedSessionChange } from "../session-change";

export function createAgentNewLockKey(): string {
  return `__new__${randomUUID()}`;
}

export async function openExistingAgentSession(sessionId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) return existing;
  const filePath = await resolveSessionPath(sessionId);
  signal?.throwIfAborted();
  if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
  const cwd = readSessionSnapshot(filePath).getHeader()?.cwd ?? "";
  return (await startRpcSession(sessionId, filePath, cwd)).session;
}

type AgentHandlers = {
  new: NonNullable<ApiHandler["agent.new"]>;
  command: NonNullable<ApiHandler["agent.command"]>;
  state: NonNullable<ApiHandler["agent.state"]>;
};
export function createAgentHandlers({
  server,
  bindEvents,
}: {
  server: Pick<RpcServer, "emit">;
  bindEvents: (session: NonNullable<ReturnType<typeof getRpcSession>>, sessionId: string) => void;
}) {
  return {
    new: async (params) => {
      const body = params as {
        cwd?: string | null;
        type?: string;
        message?: string;
        provider?: string;
        modelId?: string;
        modelSelectionExplicit?: boolean;
        toolNames?: string[];
        thinkingLevel?: string;
        [key: string]: unknown;
      };
      const { cwd: requestedCwd, provider, modelId, modelSelectionExplicit, toolNames, thinkingLevel, ...rest } = body;
      const cwd = requestedCwd ?? "";
      if (modelSelectionExplicit !== undefined && typeof modelSelectionExplicit !== "boolean")
        throw new RpcError({ code: "BAD_REQUEST", message: "modelSelectionExplicit must be a boolean" });
      if (typeof cwd !== "string") {
        throw new RpcError({ code: "BAD_REQUEST", message: "cwd must be a string or null" });
      }
      if (cwd && !existsSync(cwd)) {
        throw new RpcError({ code: "BAD_REQUEST", message: `Directory does not exist: ${cwd}` });
      }

      const tempKey = createAgentNewLockKey();
      const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
      const sessionCwd = session.cwd || cwd;
      if (sessionCwd) allowFileRoot(sessionCwd);

      // ISSUE-003: single event-binding entry only (ensureSessionEvents)
      bindEvents(session, realSessionId);

      if (
        provider &&
        modelId &&
        (modelSelectionExplicit !== false || !session.modelSelection.snapshot(session.inner)?.requiresChoice)
      ) {
        await session.send({ type: "set_model", provider, modelId });
      }
      if (thinkingLevel) {
        await session.send({ type: "set_thinking_level", level: thinkingLevel });
      }

      if (rest.type === "ensure_session") {
        return { sessionId: realSessionId, cwd: sessionCwd, data: null };
      }

      const command = rest.type ? rest : { type: "prompt", message: body.message ?? "" };
      const data = await session.send(command as Record<string, unknown>);
      await emitIndexedSessionChange(server, realSessionId, sessionCwd);
      return { sessionId: realSessionId, cwd: sessionCwd, data };
    },

    command: async (params) => {
      const { sessionId, command } = params;
      if (!isAgentCommand(command)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Agent command must have a non-empty string type" });
      }
      const session = await openExistingAgentSession(sessionId);
      bindEvents(session, sessionId);
      return session.send(command);
    },

    state: async (params) => {
      const { sessionId } = params as { sessionId: string };
      const session = getRpcSession(sessionId);
      if (!session || !session.isAlive()) return { running: false };
      const state = await session.send({ type: "get_state" });
      return { running: true, state };
    },
  } satisfies AgentHandlers;
}
