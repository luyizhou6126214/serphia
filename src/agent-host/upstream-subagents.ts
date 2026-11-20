import type { ExtensionAPI, ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";

interface SubagentsHost {
  cwd: string;
  modelRuntime: ModelRuntime;
  projectCwd(): string;
  isProjectTrusted(): boolean;
  childTools(names: readonly string[]): ToolDefinition[];
}

// The build replaces this module with the adapted upstream extension factory.
const subagents: (pi: ExtensionAPI, desktop: SubagentsHost) => void = () => {
  throw new Error("Pi Subagents extension was not included in the Agent Host build");
};
export default subagents;
