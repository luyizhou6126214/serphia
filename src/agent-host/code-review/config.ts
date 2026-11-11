import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  OCR_CONFIG_LIMIT,
  REVIEW_OPTION_DEFAULTS,
  type ReviewConfigSnapshot,
  type ReviewModelSource,
} from "../../contract/code-review";
import { ReviewError } from "./output";

export type Config = Record<string, unknown>;
export type ReviewSettings = { source: ReviewModelSource; config: Config };
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

export async function readReviewSettings(home: string): Promise<ReviewSettings> {
  const saved = await readJson(settingsFile(home));
  if (saved) {
    if ((saved.source !== "serphia" && saved.source !== "ocr") || !isObject(saved.config))
      throw new ReviewError("configInvalid");
    return { source: saved.source, config: saved.config };
  }
  const settings: ReviewSettings = { source: "serphia", config: (await readJson(runtimeFile(home))) ?? {} };
  await writeReviewSettings(home, settings);
  return settings;
}

export async function writeReviewSettings(home: string, settings: ReviewSettings) {
  await writeJson(settingsFile(home), settings);
}

export async function projectReviewConfig(home: string, settings: ReviewSettings) {
  const {
    provider: _provider,
    model: _model,
    providers: _providers,
    custom_providers: _customProviders,
    llm: _llm,
    ...engine
  } = settings.config;
  const config = settings.source === "ocr" ? settings.config : engine;
  const language = typeof config.language === "string" && config.language.trim() ? config.language : "中文";
  const projected = { ...config, language, effort: effectiveEffort(settings) };
  const current = await readJson(runtimeFile(home)).catch(() => null);
  if (JSON.stringify(current) !== JSON.stringify(projected)) await writeJson(runtimeFile(home), projected);
}

export function configSnapshot(settings: ReviewSettings): ReviewConfigSnapshot {
  const { mcp_servers: _mcpServers, ...config } = settings.config;
  const text = JSON.stringify({ ...config, language: config.language || "中文" }, null, 2);
  return {
    source: settings.source,
    text,
    revision: createHash("sha256")
      .update(settings.source + "\n" + text)
      .digest("hex"),
  };
}

const protocols = new Set(["anthropic", "anthropic-bedrock", "openai", "openai-responses"]);
const str = (value: unknown) => typeof value === "string" && !value.includes("\0");
const bool = (value: unknown) => typeof value === "boolean";
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const url = (value: unknown) =>
  value === "" ||
  (typeof value === "string" && URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol));
const strings = (value: unknown) => Array.isArray(value) && value.every(str);
const headers = (value: unknown) =>
  isObject(value) &&
  Object.entries(value).every(
    ([name, item]) =>
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) && typeof item === "string" && !/[\0\r\n]/u.test(item),
  );
const retryCodes = (value: unknown) =>
  Array.isArray(value) && value.every((code) => Number.isInteger(code) && code >= 400 && code <= 499);
const protocol = (value: unknown) => typeof value === "string" && (value === "" || protocols.has(value));
const providerName = (value: unknown) =>
  typeof value === "string" && (value === "" || /^[^\s.\0]+(?:\.[^\s.\0]+)*$/u.test(value));

type Validators = Record<string, (value: unknown) => boolean>;
const connection = {
  url,
  model: str,
  auth_header: str,
  timeout_sec: (value: unknown) => value === 0 || positive(value),
  extra_body: isObject,
  extra_headers: headers,
  retry_codes: retryCodes,
};
const providerFields: Validators = {
  ...connection,
  protocol,
  api_key: str,
  api_key_cmd: str,
  models: strings,
  aws_region: str,
  aws_profile: str,
};

function validate(value: unknown, fields: Validators): value is Config {
  return (
    isObject(value) && Object.entries(fields).every(([key, check]) => !Object.hasOwn(value, key) || check(value[key]))
  );
}

const providers = (value: unknown) =>
  isObject(value) &&
  Object.entries(value).every(
    ([name, provider]) => name !== "" && providerName(name) && validate(provider, providerFields),
  );

export function updateReviewSettings(settings: ReviewSettings, input: ReviewConfigSnapshot): ReviewSettings {
  if (input?.source !== "serphia" && input?.source !== "ocr") throw new ReviewError("configInvalid");
  if (input.revision !== configSnapshot(settings).revision) throw new ReviewError("configChanged");
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
      provider: providerName,
      model: str,
      providers,
      custom_providers: providers,
      llm: (value) =>
        validate(value, {
          ...connection,
          protocol: (item) => protocol(item) && item !== "anthropic-bedrock",
          auth_token: str,
          auth_token_cmd: str,
          use_anthropic: bool,
        }),
      telemetry: (value) =>
        validate(value, {
          enabled: bool,
          exporter: (item) => item === "" || item === "console" || item === "otlp",
          otlp_endpoint: str,
          content_logging: bool,
        }),
    }) ||
    Object.hasOwn(config, "mcp_servers")
  )
    throw new ReviewError("configInvalid");

  return {
    source: input.source,
    config: {
      ...config,
      ...(Object.hasOwn(settings.config, "mcp_servers") ? { mcp_servers: settings.config.mcp_servers } : {}),
    },
  };
}

export function reviewConnection(settings: ReviewSettings, provider?: string) {
  const { config } = settings;
  const name = provider ?? (typeof config.provider === "string" ? config.provider : "");
  for (const group of [config.providers, config.custom_providers]) {
    if (name && isObject(group) && Object.hasOwn(group, name)) {
      const entry = group[name];
      if (isObject(entry)) return entry;
    }
  }
  return isObject(config.llm) ? config.llm : {};
}

export function reviewModelStatus(settings: ReviewSettings) {
  const entry = reviewConnection(settings);
  const nativeModel = [entry.model, settings.config.model, settings.config.provider].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  return { source: settings.source, nativeModel, effort: effectiveEffort(settings) };
}

function effectiveEffort(settings: ReviewSettings): "low" | "medium" | "high" {
  const effort = settings.config.effort;
  return effort === "low" || effort === "medium" || effort === "high" ? effort : REVIEW_OPTION_DEFAULTS.effort;
}
