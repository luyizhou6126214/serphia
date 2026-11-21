import type { ComponentType } from "react";
import { Bot } from "lucide-react";
import AmpIcon from "@lobehub/icons/es/Amp/components/Mono";
import AntigravityIcon from "@lobehub/icons/es/Antigravity/components/Color";
import ClaudeCodeIcon from "@lobehub/icons/es/ClaudeCode/components/Color";
import ClineIcon from "@lobehub/icons/es/Cline/components/Mono";
import CodexIcon from "@lobehub/icons/es/Codex/components/Mono";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import DevinIcon from "@lobehub/icons/es/Devin/components/Mono";
import GeminiCliIcon from "@lobehub/icons/es/GeminiCLI/components/Color";
import CopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import HermesIcon from "@lobehub/icons/es/HermesAgent/components/Mono";
import KiloIcon from "@lobehub/icons/es/KiloCode/components/Mono";
import KimiIcon from "@lobehub/icons/es/Kimi/components/Mono";
import KiroIcon from "@lobehub/icons/es/Kiro/components/Mono";
import MastraIcon from "@lobehub/icons/es/Mastra/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import QoderIcon from "@lobehub/icons/es/Qoder/components/Mono";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Color";
import { isHerdrAgentKind, type HerdrAgentKind, type HerdrAgentKindDisplay } from "@contract/herdr";
import droidIcon from "@/assets/agents/droid.svg";
import makiIcon from "@/assets/agents/maki.png";
import ompIcon from "@/assets/agents/oh-my-pi.svg";
import piIcon from "@/assets/agents/pi.svg";

const agents = {
  pi: { label: "Pi", Icon: piIcon },
  claude: { label: "Claude Code", Icon: ClaudeCodeIcon },
  codex: { label: "Codex", Icon: CodexIcon },
  gemini: { label: "Gemini CLI", Icon: GeminiCliIcon },
  cursor: { label: "Cursor", Icon: CursorIcon },
  devin: { label: "Devin", Icon: DevinIcon },
  agy: { label: "Antigravity", Icon: AntigravityIcon },
  cline: { label: "Cline", Icon: ClineIcon },
  omp: { label: "Oh My Pi", Icon: ompIcon },
  mastracode: { label: "MastraCode", Icon: MastraIcon },
  opencode: { label: "OpenCode", Icon: OpenCodeIcon },
  copilot: { label: "GitHub Copilot", Icon: CopilotIcon },
  kimi: { label: "Kimi Code", Icon: KimiIcon },
  kiro: { label: "Kiro", Icon: KiroIcon },
  droid: { label: "Droid", Icon: droidIcon },
  amp: { label: "Amp", Icon: AmpIcon },
  grok: { label: "Grok", Icon: GrokIcon },
  hermes: { label: "Hermes Agent", Icon: HermesIcon },
  kilo: { label: "Kilo Code", Icon: KiloIcon },
  qodercli: { label: "Qoder CLI", Icon: QoderIcon },
  qwen: { label: "Qwen Code", Icon: QwenIcon },
  maki: { label: "Maki", Icon: makiIcon },
} satisfies Record<HerdrAgentKind, { label: string; Icon: string | ComponentType<{ size: number }> }>;

export function herdrAgentName(kind: HerdrAgentKindDisplay, alias?: string) {
  if (alias && alias.toLowerCase() !== kind) return alias;
  return isHerdrAgentKind(kind) ? agents[kind].label : kind.slice("unknown:".length);
}

export function HerdrAgentIcon({ kind, size = 16 }: { kind: HerdrAgentKindDisplay; size?: number }) {
  const Icon = isHerdrAgentKind(kind) ? agents[kind].Icon : Bot;
  return (
    <span className="hd-agent-icon" data-agent={kind} aria-hidden="true">
      {typeof Icon === "string" ? <img src={Icon} alt="" width={size} height={size} /> : <Icon size={size} />}
    </span>
  );
}
