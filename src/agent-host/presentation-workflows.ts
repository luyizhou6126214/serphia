import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { ApiHandler } from "../contract/rpc";
import { RpcError } from "../contract/types";
import type { PresentationWorkflow } from "../contract/presentations";
import { assertPathAllowed } from "./path-authorization";
import { openExistingAgentSession } from "./handlers/agent";
import { presentationArtifacts, savePresentationFile } from "./presentation-artifacts";
import { PRESENTATION_WORKFLOW_ENTRY, presentationWorkflowContext } from "./presentation-workflow-context";

const prepareSchema = Type.Object(
  {
    cwd: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    model: Type.Optional(
      Type.Object({ provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) }),
    ),
    toolNames: Type.Optional(Type.Array(Type.String())),
    modelSelectionExplicit: Type.Optional(Type.Boolean()),
    thinkingLevel: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export function createPresentationWorkflows(createSession: NonNullable<ApiHandler["agent.new"]>) {
  async function workflow(sessionId: string): Promise<PresentationWorkflow> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw new Error("Invalid presentation session");
    const session = await openExistingAgentSession(sessionId);
    const metadata = presentationWorkflowContext(session.inner.sessionManager);
    if (!metadata) throw new Error("This session is not a presentation workflow");
    await assertPathAllowed(metadata.directory);
    return { ...metadata, sessionId };
  }
  return {
    prepare: (async (input, requestContext) => {
      if (!Check(prepareSchema, input))
        throw new RpcError({ code: "BAD_REQUEST", message: "Invalid presentation workflow request" });
      if (input.cwd) await assertPathAllowed(await realpath(input.cwd));
      const created = await createSession(
        {
          cwd: input.cwd,
          type: "ensure_session",
          ...(input.model ? { ...input.model, modelSelectionExplicit: input.modelSelectionExplicit ?? true } : {}),
          thinkingLevel: input.thinkingLevel,
          toolNames: input.toolNames ?? [
            "read",
            "write",
            "edit",
            "ls",
            process.platform === "win32" ? "powershell" : "bash",
            "codemode",
            "tool_search",
          ],
        },
        requestContext,
      );
      const session = await openExistingAgentSession(created.sessionId);
      const cwd = await realpath(created.cwd || session.inner.sessionManager.getCwd());
      const directory = path.join(cwd, ".serphia", "presentations", randomUUID());
      await mkdir(directory, { recursive: true });
      const metadata = { cwd, directory };
      session.inner.sessionManager.appendCustomEntry(PRESENTATION_WORKFLOW_ENTRY, metadata);
      return { ...metadata, sessionId: created.sessionId };
    }) satisfies NonNullable<ApiHandler["presentations.prepare"]>,
    workflow: ({ sessionId }: { sessionId: string }) => workflow(sessionId),
    saveFile: (async ({ sessionId, ...input }) =>
      savePresentationFile((await workflow(sessionId)).directory, input)) satisfies NonNullable<
      ApiHandler["presentations.saveFile"]
    >,
    artifacts: async ({ sessionId }: { sessionId: string }) =>
      presentationArtifacts((await workflow(sessionId)).directory),
  };
}
