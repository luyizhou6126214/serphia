import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PresentationWorkflow } from "../contract/presentations";

export const PRESENTATION_WORKFLOW_ENTRY = "serphia-presentation-workflow";
export type PresentationWorkflowContext = Omit<PresentationWorkflow, "sessionId" | "prompt">;
export function presentationWorkflowContext(
  manager: Pick<SessionManager, "getEntries">,
): PresentationWorkflowContext | undefined {
  const entry = manager
    .getEntries()
    .findLast((item) => item.type === "custom" && item.customType === PRESENTATION_WORKFLOW_ENTRY);
  if (!entry || entry.type !== "custom") return;
  const value = entry.data as PresentationWorkflowContext | undefined;
  if (!value || typeof value.directory !== "string" || typeof value.cwd !== "string") return;
  return { cwd: value.cwd, directory: value.directory };
}

export function presentationWorkflowInstructions(context: PresentationWorkflowContext): string {
  return [
    "This is a persistent Serphia presentation conversation. Follow the user's current request and any skills they invoke through the normal conversation. No skill is selected or locked by the workspace.",
    `Keep this conversation's presentation source and output files inside ${context.directory}. The workspace previews complete SVG pages as files change and lists exported PPTX files. Keep supporting assets in images, icons or templates folders.`,
    "Save each complete page as soon as it is ready for live preview. Produce native editable PowerPoint objects when requested. Report actual tool results and concise execution summaries, not private reasoning.",
    "For independent page work, serphia_workflow supports visible parallel agents. Pass relevant user instructions, reference paths and agreed design constraints explicitly to each child, and assign disjoint output files. Keep shared edits and final validation/export with the coordinator. Respect dependencies and confirmation gates of the current request.",
  ].join("\n");
}
