import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { additionalSkillContext, createAdditionalSkillReferencesExtension } = await importTestBundle(
  "additional-skill-references",
  {
    stdin: {
      contents:
        'export { additionalSkillContext, createAdditionalSkillReferencesExtension } from "./additional-skill-references.ts";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
  },
);

test("loads each additional selected skill without reloading the already expanded skill", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "serphia-skills-"));
  try {
    const secondPath = path.join(dir, "SKILL.md");
    await writeFile(secondPath, "---\nname: second\n---\nSecond skill instructions.\n");
    const skills = [
      { name: "first", filePath: path.join(dir, "missing"), baseDir: dir },
      { name: "second", filePath: secondPath, baseDir: dir },
    ];
    const prompt =
      '<skill name="first" location="/first">\nFirst instructions.\n</skill>\n\nUse /skill:second and /skill:second';
    const result = await additionalSkillContext(prompt, skills);
    assert.match(result, /Second skill instructions/);
    assert.doesNotMatch(result, /name: second|First instructions/);
    assert.equal(result.match(/<skill name="second"/g).length, 1);
    assert.equal(await additionalSkillContext("plain text /skill:unknown", skills), null);
    assert.match(await additionalSkillContext("Task /skill:second", skills), /Second skill instructions/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the session extension supplies additional skill content as hidden model context", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "serphia-skill-context-"));
  try {
    const filePath = path.join(dir, "SKILL.md");
    await writeFile(filePath, "Follow this skill.");
    let handler;
    createAdditionalSkillReferencesExtension(() => [{ name: "second", filePath, baseDir: dir }]).factory({
      on(event, callback) {
        assert.equal(event, "before_agent_start");
        handler = callback;
      },
    });
    const result = await handler({ messageType: "user", prompt: "Use /skill:second" });
    assert.equal(result.message.display, false);
    assert.match(result.message.content, /Follow this skill/);
    assert.equal(await handler({ messageType: "custom" }), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
