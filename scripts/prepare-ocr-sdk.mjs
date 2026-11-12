import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function patchFile(file, replacements) {
  const original = fs.readFileSync(file, "utf8");
  let source = original;
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) throw new Error(`OCR timeout patch no longer matches ${file}`);
    source = source.replace(before, after);
  }
  if (source === original) return;

  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, source, { mode: fs.statSync(file).mode, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function prepareOcrSdk(root) {
  const pi = path.join(root, "node_modules", "@earendil-works", "pi-ai");
  const requireFromPi = createRequire(path.join(pi, "package.json"));
  // The review passes zero explicitly. Other SDK calls keep their usual defaults.
  const timeout = [
    "const timeout = setTimeout(abort, ms);",
    "const timeout = ms === 0 ? undefined : setTimeout(abort, ms);",
  ];
  patchFile(path.join(path.dirname(requireFromPi.resolve("openai")), "client.mjs"), [timeout]);
  patchFile(path.join(path.dirname(requireFromPi.resolve("@anthropic-ai/sdk")), "client.mjs"), [
    timeout,
    [
      "'X-Stainless-Timeout': String(Math.trunc(timeout / 1000)),",
      "...(timeout ? { 'X-Stainless-Timeout': String(Math.trunc(timeout / 1000)) } : {}),",
    ],
  ]);
  patchFile(path.join(pi, "dist", "api", "mistral-conversations.js"), [
    [
      "const headerTimeoutSignal = AbortSignal.timeout(timeoutMs);",
      "const headerTimeoutSignal = timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs);",
    ],
    ["if (headerTimeoutSignal.aborted &&", "if (headerTimeoutSignal?.aborted &&"],
  ]);
}
