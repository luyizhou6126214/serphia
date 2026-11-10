import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";

const { ComposerStats, formatStatCacheHit, formatStatTokens, formatStatTokensPerSecond } = await importTestBundle(
  "composer-stats",
  {
    mainFields: ["module", "main"],
    stdin: {
      contents:
        'export {ComposerStats} from "./ComposerStats.tsx"; export {formatStatCacheHit, formatStatTokens, formatStatTokensPerSecond} from "./composer-stats-format.ts";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);

const text = (node) => (typeof node === "string" ? node : (node?.children?.map(text).join("") ?? ""));

test("formats compact tokens, throughput and honest cache hits", () => {
  assert.equal(formatStatTokens(517), "517");
  assert.equal(formatStatTokens(12_200), "12.2K");
  assert.equal(formatStatTokens(108_000_000), "108M");
  assert.equal(formatStatTokensPerSecond(168.6), "169");
  assert.equal(formatStatTokensPerSecond(8.44), "8.4");
  assert.equal(formatStatCacheHit(0, 0), null);
  assert.equal(formatStatCacheHit(996, 1_000), "99.6");
  assert.equal(formatStatCacheHit(999, 1_000), "99.9");
  assert.equal(formatStatCacheHit(1_000, 1_000), "100");
});

test("renders activity, usage and context readings", async () => {
  let component;
  await act(async () => {
    component = create(
      createElement(ComposerStats, {
        sessionStats: {
          sessionId: "fixture",
          userMessages: 5,
          assistantMessages: 427,
          toolCalls: 300,
          toolResults: 300,
          totalMessages: 732,
          tokens: { input: 400_000, output: 800_000, cacheRead: 107_000_000, cacheWrite: 0, total: 108_200_000 },
          cost: 1,
          tokensPerSecond: 169,
        },
        contextUsage: { percent: 46, contextWindow: 1_000_000, tokens: 460_000 },
      }),
    );
  });
  const rendered = text(component.toJSON());
  assert.match(rendered, /5 turns 427 steps/);
  assert.match(rendered, /169 tok\/s/);
  assert.match(rendered, /108M tok/);
  assert.match(rendered, /Cache hit 99\.6%/);
  assert.match(rendered, /46%/);
  component.unmount();
});

test("keeps the unmeasured context reading out instead of rendering NaN", async () => {
  let component;
  await act(async () => {
    component = create(
      createElement(ComposerStats, {
        sessionStats: null,
        contextUsage: { percent: null, contextWindow: 1_000_000, tokens: null },
      }),
    );
  });
  assert.equal(component.toJSON(), null);
  component.unmount();
});

test("each reading opens its own stats dialog", async () => {
  const sessionStats = {
    sessionId: "fixture",
    userMessages: 1,
    assistantMessages: 253,
    toolCalls: 200,
    toolResults: 200,
    totalMessages: 454,
    tokens: { input: 400_000, output: 111_095, cacheRead: 1_164_032, cacheWrite: 0, total: 1_675_127 },
    cost: 1,
    tokensPerSecond: 133,
    llmDurationMs: 3_392_000,
    toolDurationMs: 291_000,
  };
  const contextUsage = { percent: 36, contextWindow: 1_000_000, tokens: 360_000 };
  const mount = async () => {
    let component;
    await act(async () => {
      component = create(createElement(ComposerStats, { sessionStats, contextUsage }));
    });
    return component;
  };

  const activity = await mount();
  const activityButtons = activity.root.findAllByType("button");
  await act(async () => activityButtons[0].props.onClick());
  let rendered = text(activity.toJSON());
  assert.match(rendered, /Session stats/);
  assert.match(rendered, /1 turns 253 steps/);
  assert.match(rendered, /Model time/);
  assert.match(rendered, /56m 32s/);
  assert.match(rendered, /Tool time/);
  assert.match(rendered, /4m 51s/);
  assert.match(rendered, /Output speed/);
  assert.match(rendered, /133 tok\/s/);
  await act(async () => activity.unmount());

  const usage = await mount();
  const usageButtons = usage.root.findAllByType("button");
  await act(async () => usageButtons[1].props.onClick());
  rendered = text(usage.toJSON());
  assert.match(rendered, /Token usage/);
  assert.match(rendered, /1,675,127/);
  assert.match(rendered, /Cache hit/);
  assert.match(rendered, /74%/);
  assert.match(rendered, /Cache read/);
  assert.match(rendered, /1,164,032/);
  await act(async () => usage.unmount());

  const context = await mount();
  const contextButtons = context.root.findAllByType("button");
  await act(async () => contextButtons[2].props.onClick());
  rendered = text(context.toJSON());
  assert.match(rendered, /Context usage/);
  assert.match(rendered, /36%/);
  assert.match(rendered, /Used/);
  assert.match(rendered, /Remaining/);
  await act(async () => context.unmount());
});
