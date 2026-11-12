import { createHash } from "node:crypto";
import path from "node:path";
import { OCR_CONFIG_LIMIT, type ReviewMcpSnapshot } from "../../contract/code-review";
import { isObject as object, readReviewSettings, writeReviewSettings } from "./config";
import { ReviewError } from "./output";
import { runOcr } from "./runner";
import type { Workspace } from "./scope";

type McpServer = {
  type?: "stdio" | "remote";
  command?: string;
  args?: string[];
  env?: string[];
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
  setup?: string;
};

const FIELDS = new Set(["type", "command", "args", "env", "url", "headers", "tools", "setup"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function string(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\0");
}

function validateServers(value: unknown): Record<string, McpServer> {
  if (!object(value) || Object.keys(value).length > 32) throw new ReviewError("mcpConfig");
  for (const [name, server] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name) || !object(server)) throw new ReviewError("mcpConfig");
    for (const [key, field] of Object.entries(server)) {
      if (!FIELDS.has(key)) throw new ReviewError("mcpConfig");
      switch (key) {
        case "args":
        case "env":
        case "tools":
          if (!Array.isArray(field) || field.length > 128 || !field.every(string)) throw new ReviewError("mcpConfig");
          if (
            key === "env" &&
            field.some((item) => !ENV_NAME.test(item.slice(0, item.indexOf("="))) || !item.includes("="))
          ) {
            throw new ReviewError("mcpConfig");
          }
          if (key === "tools" && field.some((item) => !item.trim())) throw new ReviewError("mcpConfig");
          break;
        case "headers":
          if (
            !object(field) ||
            Object.entries(field).some(
              ([header, val]) =>
                !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(header) ||
                !string(val) ||
                !val.trim() ||
                /[\r\n]|\$\{?OCR_/iu.test(val),
            )
          ) {
            throw new ReviewError("mcpConfig");
          }
          break;
        default:
          if (!string(field)) throw new ReviewError("mcpConfig");
      }
    }
    if (server.type === "remote") {
      const url = URL.canParse(String(server.url ?? "")) ? new URL(String(server.url)) : null;
      if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new ReviewError("mcpConfig");
      }
    } else if (
      (server.type !== undefined && server.type !== "stdio") ||
      typeof server.command !== "string" ||
      !server.command.trim() ||
      /[\r\n]/u.test(server.command)
    ) {
      throw new ReviewError("mcpConfig");
    }
  }
  return value as Record<string, McpServer>;
}

function serversFrom(config: Record<string, unknown>) {
  if (config.mcp_servers == null) return {};
  if (!object(config.mcp_servers)) throw new ReviewError("mcpConfig");
  return validateServers(
    Object.fromEntries(
      Object.entries(config.mcp_servers).map(([name, server]) => {
        if (!object(server)) throw new ReviewError("mcpConfig");
        const { serphia_setup, setup, ...fields } = server;
        const script = serphia_setup ?? setup;
        return [name, script === undefined ? fields : { ...fields, setup: script }];
      }),
    ),
  );
}

function snapshot(servers: Record<string, McpServer>): ReviewMcpSnapshot {
  const text = JSON.stringify(servers, null, 2);
  return { text, revision: createHash("sha256").update(text).digest("hex") };
}

export async function readReviewMcp(home: string) {
  return snapshot(serversFrom((await readReviewSettings(home)).config));
}

export async function writeReviewMcp(home: string, input: ReviewMcpSnapshot) {
  if (typeof input?.text !== "string" || Buffer.byteLength(input.text) > OCR_CONFIG_LIMIT) {
    throw new ReviewError("mcpConfig");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    throw new ReviewError("mcpConfig");
  }
  const servers = validateServers(parsed);
  const settings = await readReviewSettings(home);
  const { config } = settings;
  if (snapshot(serversFrom(config)).revision !== input.revision) throw new ReviewError("mcpChanged");

  // OCR runs native setup in a separate process group. Serphia runs this field
  // inside its managed process boundary so cancellation also stops setup.
  config.mcp_servers = Object.fromEntries(
    Object.entries(servers).map(([name, { setup, ...server }]) => [
      name,
      setup ? { ...server, serphia_setup: setup } : server,
    ]),
  );
  await writeReviewSettings(home, settings);
  return snapshot(servers);
}

export async function prepareReviewMcp(home: string, workspace: Workspace, signal: AbortSignal) {
  const { config } = await readReviewSettings(home);
  const servers = serversFrom(config);
  const nativeServers = config.mcp_servers;
  if (object(nativeServers) && Object.values(nativeServers).some((server) => object(server) && server.setup)) {
    // Normalize manually imported native entries before allowing OCR to start.
    await writeReviewMcp(home, snapshot(servers));
  }
  const env: Record<string, string> = { ...workspace.env };
  const names = Object.values(servers);
  if (names.some((server) => server.type !== "remote")) {
    const inherited = (process.env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute);
    env.PATH = [...new Set([...env.PATH.split(path.delimiter), ...inherited])].join(path.delimiter);
  }
  let ranSetup = false;
  for (const server of names) {
    if (server.type === "remote") {
      for (const header of Object.values(server.headers ?? {})) {
        for (const match of header.matchAll(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/gu)) {
          const name = match[1] ?? match[2];
          if (!/^OCR_/iu.test(name) && !Object.hasOwn(env, name) && process.env[name] !== undefined) {
            env[name] = process.env[name];
          }
        }
      }
      continue;
    }
    if (!server.setup) continue;
    const windows = process.platform === "win32";
    const executable = windows ? path.join(env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe") : "/bin/sh";
    const result = await runOcr({
      executable,
      args: windows ? ["/d", "/s", "/c", server.setup] : ["-c", server.setup],
      cwd: workspace.root,
      env,
      signal,
    });
    if (result.code !== 0) throw new ReviewError("mcpSetup");
    ranSetup = true;
  }
  return { env, ranSetup };
}
