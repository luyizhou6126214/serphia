import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseSkillInvocation } from "../shared/skill-invocation";

type AvailableSkill = { name: string; filePath: string; baseDir: string };

/** Pi expands only a leading skill; provide other explicitly referenced skills as hidden context. */
export async function additionalSkillContext(
  prompt: string,
  skills: readonly AvailableSkill[],
): Promise<string | null> {
  const leading = parseSkillInvocation(prompt);
  const userText = leading ? (leading.userMessage ?? "") : prompt;
  const names = new Set(Array.from(userText.matchAll(/(?:^|\s)\/skill:([^\s]+)/g), (match) => match[1]));
  if (leading) names.delete(leading.name);
  const selected = skills.filter((skill) => names.has(skill.name));
  if (!selected.length) return null;
  const blocks = await Promise.all(
    selected.map(async (skill) => {
      const source = await readFile(skill.filePath, "utf8");
      const body = source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
      return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    }),
  );
  return blocks.join("\n\n");
}

export function createAdditionalSkillReferencesExtension(getSkills: () => readonly AvailableSkill[]) {
  return {
    name: "pi-desktop-additional-skills",
    hidden: true,
    factory(pi: ExtensionAPI) {
      pi.on("before_agent_start", async (event) => {
        if (event.messageType !== "user") return;
        const content = await additionalSkillContext(event.prompt, getSkills());
        if (!content) return;
        return { message: { customType: "desktop-skill-references", content, display: false } };
      });
    },
  };
}
