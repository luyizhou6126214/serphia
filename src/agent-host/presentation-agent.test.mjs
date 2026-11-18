import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

test(
  "a Pi session generates an editable outline and page through configured model settings",
  { timeout: 20_000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "serphia-presentation-agent-"));
    process.env.PI_CODING_AGENT_DIR = root;
    process.env.PI_OFFLINE = "1";
    const { createPresentationAgent, decodeAgentSlide } = await importTestBundle("presentation-agent", {
      packages: "external",
      entryPoints: [path.join(import.meta.dirname, "presentation-agent.ts")],
    });
    const outline = {
      title: "月度简报",
      accent: "#2C5282",
      pages: [{ title: "月度成果", summary: "写出主要成果", layout: "cover" }],
    };
    const page = {
      title: "月度成果",
      background: "#FFFFFF",
      elements: [
        {
          kind: "text",
          x: 100,
          y: 120,
          w: 560,
          h: 160,
          text: "交付了客户门户",
          size: 54,
          color: "#111111",
          bold: true,
          align: "left",
        },
      ],
    };
    const requests = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const body = requests.at(-1);
      const output = JSON.stringify(body.messages).includes("Plan exactly") ? outline : page;
      const needsTool = !body.messages.some((message) => message.role === "tool");
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finish] of needsTool
        ? [
            [
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "design-plan",
                    type: "function",
                    function: {
                      name: "report_design",
                      arguments: JSON.stringify({ summary: "使用清晰的标题层级和充分留白，保留来源事实。" }),
                    },
                  },
                ],
              },
              null,
            ],
            [{}, "tool_calls"],
          ]
        : [
            [{ role: "assistant", content: JSON.stringify(output).slice(0, -2) }, null],
            [{ content: JSON.stringify(output).slice(-2) }, null],
            [{}, "stop"],
          ]) {
        response.write(
          "data: " +
            JSON.stringify({
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: "fixture",
              choices: [{ index: 0, delta, finish_reason: finish }],
            }) +
            "\n\n",
        );
      }
      response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    await writeFile(
      path.join(root, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
            apiKey: "local-fixture",
            models: [{ id: "fixture", name: "Pi Fixture", input: ["text"], contextWindow: 32_768, maxTokens: 2048 }],
          },
        },
      }),
    );
    await writeFile(
      path.join(root, "settings.json"),
      JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture" }),
    );
    const events = [];
    const agent = createPresentationAgent((event) => events.push(event));
    const leases = new Map();
    const context = {
      setLease(key, release) {
        leases.set(key, release);
      },
      releaseLease(key) {
        const release = leases.get(key);
        leases.delete(key);
        release?.();
        return !!release;
      },
    };
    const input = { cwd: null, language: "zh-CN", prompt: "做一份简报", source: "交付了客户门户" };
    assert.deepEqual(await agent.outline({ ...input, count: 1, id: randomUUID() }, context), outline);
    assert.deepEqual(await agent.page({ ...input, outline, index: 0, id: randomUUID() }, context), page);
    assert.equal(leases.size, 0);
    assert.equal(requests.length, 4);
    assert.ok(requests.every((request) => request.tools?.some((tool) => tool.function.name === "report_design")));
    assert.ok(events.some((event) => event.type === "render" && event.slide.elements.length === 1));
    assert.equal(events.filter((event) => event.type === "complete").length, 2);
    assert.equal(events.filter((event) => event.type === "summary").length, 2);
    assert.equal(events.filter((event) => event.type === "tool_start").length, 2);
    assert.equal(events.filter((event) => event.type === "tool_end").length, 2);
    assert.ok(events.every((event) => event.type !== "thinking"));
    assert.match(JSON.stringify(requests[1].messages), /交付了客户门户/);
    assert.throws(
      () => decodeAgentSlide(JSON.stringify({ ...page, elements: [{ ...page.elements[0], shell: "invalid" }] })),
      /format/,
    );
  },
);
