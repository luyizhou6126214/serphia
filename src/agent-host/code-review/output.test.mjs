import assert from "node:assert/strict";
import test from "node:test";
import { parsePreview, parseReview } from "./output.ts";

test("OCR preview preserves exclusions and rejects escaping paths", () => {
  const file = { path: ".env", status: "added", will_review: false, exclude_reason: "secret_exclude", insertions: 1 };
  assert.deepEqual(parsePreview(JSON.stringify({ files: [file] })), [
    { path: ".env", status: "added", included: false, reason: "secret_exclude", insertions: 1, deletions: 0 },
  ]);
  for (const path of ["../secret.ts", "..\\secret.ts", "/root.ts", "C:secret.ts", ".git/config"]) {
    assert.throws(() => parsePreview(JSON.stringify({ files: [{ ...file, path }] })), /invalidOutput/u);
  }
});

test("OCR results distinguish skipped, zero findings, partial delivery and failure", () => {
  const parse = (status, code, warnings = []) =>
    parseReview(JSON.stringify({ status, comments: [], warnings }), code, "", "key");
  assert.equal(parse("skipped", 0).state, "skipped");
  assert.equal(parse("complete", 0).state, "complete");
  assert.equal(parse("partial", 1, [{}]).state, "partial");
  assert.equal(parse("failed", 1, [{}]).state, "failed");
  assert.equal(parse("failed", 1, [{ type: "token_budget_reached" }]).issue, "tokenBudget");
  assert.throws(() => parseReview("", 1, "HTTP 429", "key"), /rateLimit/u);
  assert.throws(() => parseReview("not a JSON object", 0, "", "key"), /invalidOutput/u);
});

test("OCR findings retain safe locations and redact a provider credential in model text", () => {
  const value = parseReview(
    JSON.stringify({
      status: "complete",
      comments: [
        { path: "src/file.ts", content: "This should not include sk-test-key", start_line: 3, severity: "high" },
      ],
    }),
    0,
    "",
    "sk-test-key",
  );
  assert.deepEqual(value.findings[0], {
    id: 0,
    path: "src/file.ts",
    message: "This should not include [redacted]",
    line: 3,
    endLine: null,
    severity: "high",
    category: undefined,
    suggestion: undefined,
  });
});
