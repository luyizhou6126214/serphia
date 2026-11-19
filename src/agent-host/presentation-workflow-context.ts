import path from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { PRESENTATION_WORKFLOW_SKILL, type PresentationWorkflow } from "../contract/presentations";

export const PRESENTATION_WORKFLOW_ENTRY = "serphia-presentation-workflow";
export type PresentationWorkflowContext = Omit<PresentationWorkflow, "sessionId">;
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
    `The official ${PRESENTATION_WORKFLOW_SKILL} skill is locked for this PPT conversation. For generation and revision, follow its entry point at ${path.join(process.env.PI_DESKTOP_PPT_MASTER_DIR ?? PRESENTATION_WORKFLOW_SKILL, "SKILL.md")}, including its mandatory load order, routing, confirmation gates, validation and native PPTX export. Additional skills invoked in the conversation can assist within this workflow.`,
    `Work inside ${context.directory}. The editor opens completed .pptx exports from this directory. Preserve editable text, shapes, charts and tables. Use the latest saved PPTX as the source for follow-up edits to a finished deck, including changes made by the user in the editor.`,
    "For design confirmation use the official confirm_ui page branch. Studio embeds that form in the left pane; chat stays on the right. Place your project under the workflow directory above. Prepare the complete Stage 1 recommendations with template_options and selectable template candidates. Run confirm_ui/server.py <project> --daemon --no-browser (reuse the running project service on resume). Tell the user they can edit and confirm in the left pane, then immediately run --wait-only --wait-stage stage1 --wait-timeout 0. Use the submitted fields and template selection, install the chosen templates or close free design, write fresh Stage 2 recommendations, and run --wait-only --wait-stage final --wait-timeout 0. Keep the turn active through both waits; each successful receipt is explicit approval. On resume read existing receipts and continue the first outstanding step. On a service error repair or restart the embedded form. Do not request duplicate chat confirmation.",
    "Review any subsequent design-spec revisions in the right conversation. After final form submission continue generation and native export; Studio displays the finished file in its editable PPTX pane. This replaces the upstream browser live-preview startup. Do not open the system browser, send localhost links or launch interactive spec_review or svg_editor services. Headless checks may run in the background.",
    "For independent page work, serphia_workflow supports visible parallel agents. Pass relevant user instructions, reference paths and agreed design constraints explicitly to each child, and assign disjoint output files. Keep shared edits and final validation/export with the coordinator. Respect dependencies and confirmation gates of the current request.",
  ].join("\n");
}
