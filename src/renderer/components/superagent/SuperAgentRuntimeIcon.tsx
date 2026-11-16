import ClaudeIcon from "@lobehub/icons/es/Claude/components/Mono";
import CodexIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Mono";
import type { SuperAgentCli } from "@contract/superagent";

export const cliNames = { claude: "Claude Code", codex: "Codex", dsh: "DeepSeek Harness" };
const cliIcons = { claude: ClaudeIcon, codex: CodexIcon, dsh: DeepSeekIcon };

export function RuntimeIcon({ cli, size = 16 }: { cli: SuperAgentCli; size?: number }) {
  const Icon = cliIcons[cli];
  return (
    <span className="sa-runtime-icon" data-cli={cli} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
