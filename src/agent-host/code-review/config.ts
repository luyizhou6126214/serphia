import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { OCR_CONFIG_LIMIT, REVIEW_OPTION_DEFAULTS, type ReviewConfigSnapshot } from "../../contract/code-review";
import { ReviewError } from "./output";

export type Config = Record<string, unknown>;
export type ReviewSettings = { config: Config };
export const isObject = (value: unknown): value is Config =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const settingsFile = (home: string) => path.join(home, ".opencodereview", "serphia-config.json");
const runtimeFile = (home: string) => path.join(home, ".opencodereview", "config.json");

async function readJson(file: string) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > OCR_CONFIG_LIMIT) throw new ReviewError("configInvalid");
    const data: unknown = JSON.parse(await readFile(file, "utf8"));
    if (isObject(data)) return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
  }
  throw new ReviewError("configInvalid");
}

async function writeJson(file: string, value: Config) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(text) > OCR_CONFIG_LIMIT) throw new ReviewError("configInvalid");
  const temp = file + "." + randomUUID() + ".tmp";
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, text, { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

const modelKeys = new Set(["provider", "model", "providers", "custom_providers", "llm"]);
const isModelKey = (key: string) => modelKeys.has(key.toLowerCase());

export async function readReviewSettings(home: string): Promise<ReviewSettings> {
  const saved = await readJson(settingsFile(home));
  const original = saved ? saved.config : ((await readJson(runtimeFile(home))) ?? {});
  if (!isObject(original)) throw new ReviewError("configInvalid");
  const config = Object.fromEntries(Object.entries(original).filter(([key]) => !isModelKey(key)));
  const settings = { config };
  if (!saved || Object.hasOwn(saved, "source") || Object.keys(original).some(isModelKey)) {
    await writeReviewSettings(home, settings);
  }
  return settings;
}

export async function writeReviewSettings(home: string, settings: ReviewSettings) {
  await writeJson(settingsFile(home), settings);
}

export async function projectReviewConfig(home: string, settings: ReviewSettings) {
  const { config } = settings;
  const language = typeof config.language === "string" && config.language.trim() ? config.language : "中文";
  const projected = { ...config, language, effort: effectiveEffort(settings) };
  const current = await readJson(runtimeFile(home)).catch(() => null);
  if (JSON.stringify(current) !== JSON.stringify(projected)) await writeJson(runtimeFile(home), projected);
}

export function configSnapshot(settings: ReviewSettings): ReviewConfigSnapshot {
  const { mcp_servers: _mcpServers, ...config } = settings.config;
  const text = JSON.stringify({ ...config, language: config.language || "中文" }, null, 2);
  return { text, revision: createHash("sha256").update(text).digest("hex") };
}

const str = (value: unknown) => typeof value === "string" && !value.includes("\0");
const bool = (value: unknown) => typeof value === "boolean";
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

type Validators = Record<string, (value: unknown) => boolean>;
function validate(value: unknown, fields: Validators): value is Config {
  return (
    isObject(value) && Object.entries(fields).every(([key, check]) => !Object.hasOwn(value, key) || check(value[key]))
  );
}

export function updateReviewSettings(settings: ReviewSettings, input: ReviewConfigSnapshot): ReviewSettings {
  if (input?.revision !== configSnapshot(settings).revision) throw new ReviewError("configChanged");
  if (typeof input.text !== "string" || Buffer.byteLength(input.text) > OCR_CONFIG_LIMIT)
    throw new ReviewError("configInvalid");
  let config: unknown;
  try {
    config = JSON.parse(input.text);
  } catch {
    throw new ReviewError("configInvalid");
  }
  if (
    !validate(config, {
      language: str,
      effort: (value) => value === "" || value === "low" || value === "medium" || value === "high",
      max_tokens: (value) => value === 0 || positive(value),
      telemetry: (value) =>
        validate(value, {
          enabled: bool,
          exporter: (item) => item === "" || item === "console" || item === "otlp",
          otlp_endpoint: str,
          content_logging: bool,
        }),
    }) ||
    Object.keys(config).some((key) => isModelKey(key) || key.toLowerCase() === "mcp_servers")
  )
    throw new ReviewError("configInvalid");

  return {
    config: {
      ...config,
      ...(Object.hasOwn(settings.config, "mcp_servers") ? { mcp_servers: settings.config.mcp_servers } : {}),
    },
  };
}

export function reviewEngineStatus(settings: ReviewSettings) {
  return { effort: effectiveEffort(settings) };
}

function effectiveEffort(settings: ReviewSettings): "low" | "medium" | "high" {
  const effort = settings.config.effort;
  return effort === "low" || effort === "medium" || effort === "high" ? effort : REVIEW_OPTION_DEFAULTS.effort;
}
