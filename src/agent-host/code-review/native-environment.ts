import { homedir } from "node:os";
import path from "node:path";
import { reviewConnection, type ReviewSettings } from "./config";

// Only the selected preset's credential is forwarded to the OCR process.
const presetCredentials: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-responses": "OPENAI_RESPONSES_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  edenai: "EDENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  "dashscope-tokenplan": "DASHSCOPE_TOKENPLAN_KEY",
  volcengine: "ARK_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "tencent-tokenhub": "TENCENT_TOKENHUB_API_KEY",
  "hy-tokenplan": "TENCENT_HUNYUAN_TOKENPLAN_KEY",
  iflytek: "SPARK_API_KEY",
  kimi: "MOONSHOT_API_KEY",
  "kimi-global": "MOONSHOT_GLOBAL_API_KEY",
  "z-ai": "Z_AI_API_KEY",
  "z-ai-coding": "Z_AI_CODING_API_KEY",
  mimo: "MIMO_API_KEY",
  minimax: "MINIMAX_GLOBAL_API_KEY",
  "minimax-cn": "MINIMAX_API_KEY",
  "baidu-qianfan": "QIANFAN_API_KEY",
  "siliconflow-cn": "SILICONFLOW_API_KEY",
  siliconflow: "SILICONFLOW_GLOBAL_API_KEY",
  novita: "NOVITA_API_KEY",
  xai: "XAI_API_KEY",
  litellm: "LITELLM_API_KEY",
  "ollama-cloud": "OLLAMA_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

export function nativeReviewEnvironment(settings: ReviewSettings, pathPrefix?: string): Record<string, string> {
  const { provider } = settings.config;
  const connection = reviewConnection(settings);
  const keys = ["OCR_LLM_TIMEOUT", "OCR_LLM_EXTRA_HEADERS"];
  const paths = [pathPrefix, process.env.PATH].flatMap((entry) => entry?.split(path.delimiter) ?? []);
  const env: Record<string, string> = { PATH: [...new Set(paths.filter(path.isAbsolute))].join(path.delimiter) };
  if (typeof provider === "string" && provider) {
    if (!connection.api_key && !connection.api_key_cmd && Object.hasOwn(presetCredentials, provider))
      keys.push(presetCredentials[provider]);
  } else if (!connection.url) {
    keys.push(
      "OCR_LLM_URL",
      "OCR_LLM_TOKEN",
      "OCR_LLM_MODEL",
      "OCR_LLM_PROTOCOL",
      "OCR_LLM_AUTH_HEADER",
      "OCR_USE_ANTHROPIC",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_MODEL",
    );
  }
  if (provider === "bedrock" || connection.protocol === "anthropic-bedrock") {
    keys.push(
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_CONFIG_FILE",
      "AWS_SHARED_CREDENTIALS_FILE",
    );
    env.AWS_CONFIG_FILE = path.join(homedir(), ".aws", "config");
    env.AWS_SHARED_CREDENTIALS_FILE = path.join(homedir(), ".aws", "credentials");
  }
  for (const key of keys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}
