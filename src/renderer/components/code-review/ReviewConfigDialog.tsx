import { useEffect, useRef, useState, type ReactNode } from "react";
import { Braces, Plug, Settings2, X } from "lucide-react";
import {
  OCR_CONFIG_LIMIT,
  type ReviewConfigSnapshot,
  type ReviewModelSource,
  type ReviewModelStatus,
} from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { reviewIssueText } from "./copy";
import { ReviewSelect } from "./ReviewSelect";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const connection = {
  url: "",
  protocol: "openai",
  model: "",
  auth_header: "",
  timeout_sec: 300,
  extra_body: {},
  extra_headers: {},
  retry_codes: [],
};
const providerFields = { ...connection, api_key: "", api_key_cmd: "", models: [], aws_region: "", aws_profile: "" };
const legacyFields = { ...connection, auth_token: "", auth_token_cmd: "", use_anthropic: false };

export function ReviewConfigDialog({
  busy,
  onClose,
  onSaved,
  onOpenModels,
  onOpenMcp,
}: {
  busy: boolean;
  onClose: () => void;
  onSaved: (status: ReviewModelStatus) => void;
  onOpenModels: () => void;
  onOpenMcp: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<ReviewConfigSnapshot>();
  const [source, setSource] = useState<ReviewModelSource>("serphia");
  const [draft, setDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void call("codeReview.config.get")
      .then((result) => {
        if (!current) return;
        if (result.ok) {
          setSnapshot(result.value);
          setDraft(result.value.text);
          setSource(result.value.source);
          setMessage("");
        } else setMessage(reviewIssueText(result.issue, t));
      })
      .catch(() => {
        if (current) setMessage(t("reviewOcrConfigUnavailable", "Could not read the OCR configuration."));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [revision, t]);

  let config: Json | null = null;
  try {
    config = object(JSON.parse(draft));
  } catch {
    /* The editor retains incomplete JSON. */
  }
  const telemetry = object(config?.telemetry);
  const disabled = !snapshot || loading || busy;
  const fieldDisabled = disabled || !config;
  const dirty = snapshot && (snapshot.text !== draft || snapshot.source !== source);

  function update(key: string, value: unknown, section?: string) {
    if (!config) return;
    const target = section ? { ...(object(config[section]) ?? {}) } : { ...config };
    if (value === undefined) delete target[key];
    else target[key] = value;
    setDraft(JSON.stringify(section ? { ...config, [section]: target } : target, null, 2));
  }

  function insertProvider(custom: boolean) {
    if (!config) return;
    const section = custom ? "custom_providers" : "providers";
    const name = custom ? "my-provider" : "openai";
    const existing = object(config[section]) ?? {};
    update(section, {
      ...existing,
      [name]: { ...providerFields, protocol: custom ? providerFields.protocol : "", ...object(existing[name]) },
    });
  }

  async function save() {
    if (disabled || !snapshot || !config || !dirty) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await call("codeReview.config.save", { revision: snapshot.revision, text: draft, source });
      if (result.ok) {
        const { status, ...saved } = result.value;
        setSnapshot(saved);
        setDraft(saved.text);
        onSaved(status);
        setMessage(t("reviewOcrConfigSaved", "OCR configuration saved."));
      } else setMessage(reviewIssueText(result.issue, t));
    } catch {
      setMessage(t("reviewOcrConfigSaveFailed", "Could not save the OCR configuration."));
    } finally {
      setLoading(false);
    }
  }

  function field(label: string, input: ReactNode) {
    return (
      <label>
        {label}
        {input}
      </label>
    );
  }

  return (
    <dialog
      className="cr-dialog cr-options-dialog cr-config-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="ocr-config-title"
    >
      <header>
        <div className="cr-dialog-title">
          <Settings2 size={17} />
          <h2 id="ocr-config-title">{t("reviewEngineConfig", "Engine configuration")}</h2>
        </div>
        <button type="button" className="cr-control" onClick={onClose} aria-label={t("reviewClose", "Close")}>
          <X size={17} />
        </button>
      </header>
      <form
        className="cr-options-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="cr-options-content">
          <fieldset className="cr-option-section" disabled={fieldDisabled}>
            <legend>{t("reviewOcrDefaults", "Review defaults")}</legend>
            <div className="cr-form-grid">
              {field(
                t("reviewOcrLanguage", "Review language"),
                <input
                  list="ocr-review-languages"
                  value={typeof config?.language === "string" ? config.language : ""}
                  placeholder="中文"
                  onChange={(event) => update("language", event.target.value || undefined)}
                />,
              )}
              <datalist id="ocr-review-languages">
                <option value="中文" />
                <option value="English" />
                <option value="繁體中文" />
                <option value="日本語" />
              </datalist>
              {field(
                t("reviewPromptBudget", "Prompt tokens per task"),
                <input
                  type="number"
                  min={1}
                  value={typeof config?.max_tokens === "number" && config.max_tokens > 0 ? config.max_tokens : ""}
                  placeholder={t("thinkingAuto", "Auto")}
                  onChange={(event) => update("max_tokens", event.target.valueAsNumber || undefined)}
                />,
              )}
              <label>
                {t("reviewEffort", "OCR review passes")}
                <ReviewSelect
                  label={t("reviewEffort", "OCR review passes")}
                  value={String(config?.effort || "low")}
                  disabled={fieldDisabled}
                  onChange={(value) => update("effort", value)}
                >
                  <option value="low">{t("thinkingLow", "Low")}</option>
                  <option value="medium">{t("thinkingMedium", "Medium")}</option>
                  <option value="high">{t("thinkingHigh", "High")}</option>
                </ReviewSelect>
              </label>
            </div>
          </fieldset>
          <fieldset className="cr-option-section" disabled={disabled}>
            <legend>
              <Plug size={14} />
              {t("reviewOcrConnection", "Model connection")}
            </legend>
            <ReviewSelect
              label={t("reviewOcrConnection", "Model connection")}
              value={source}
              disabled={disabled}
              onChange={(value) => setSource(value as ReviewModelSource)}
            >
              <option value="serphia">{t("reviewOcrUseSerphia", "Serphia models and authentication")}</option>
              <option value="ocr">{t("reviewOcrUseNative", "Native OCR connection")}</option>
            </ReviewSelect>
            <p className="cr-field-tip">
              {source === "ocr"
                ? t(
                    "reviewOcrNativeHint",
                    "OCR uses provider and credential settings from the JSON below. Test the connection from OCR tools.",
                  )
                : t(
                    "reviewOcrSerphiaHint",
                    "Reviews use the model and authentication selected in Serphia. Native connection fields are saved for when you switch to OCR.",
                  )}
            </p>
            <div className="cr-config-actions">
              <button type="button" className="cr-control" onClick={onOpenModels}>
                {t("reviewManageModels", "Manage models and authentication")}
              </button>
              <button type="button" className="cr-control" onClick={onOpenMcp}>
                {t("reviewMcp", "OCR MCP")}
              </button>
            </div>
          </fieldset>
          <fieldset className="cr-option-section" disabled={fieldDisabled}>
            <legend>{t("reviewOcrTelemetry", "Telemetry")}</legend>
            <label className="cr-option-toggle">
              <input
                type="checkbox"
                checked={telemetry?.enabled === true}
                onChange={(event) => update("enabled", event.target.checked, "telemetry")}
              />
              <span>{t("reviewOcrTelemetryEnabled", "Enable telemetry")}</span>
            </label>
            <div className="cr-form-grid">
              <label>
                {t("reviewOcrExporter", "Exporter")}
                <ReviewSelect
                  label={t("reviewOcrExporter", "Exporter")}
                  value={String(telemetry?.exporter || "")}
                  disabled={fieldDisabled}
                  onChange={(value) => update("exporter", value || undefined, "telemetry")}
                >
                  <option value="">{t("thinkingAuto", "Auto")}</option>
                  <option value="console">Console</option>
                  <option value="otlp">OTLP</option>
                </ReviewSelect>
              </label>
              {field(
                t("reviewOcrOtlpEndpoint", "OTLP endpoint"),
                <input
                  value={typeof telemetry?.otlp_endpoint === "string" ? telemetry.otlp_endpoint : ""}
                  placeholder="http://localhost:4317"
                  onChange={(event) => update("otlp_endpoint", event.target.value || undefined, "telemetry")}
                />,
              )}
            </div>
            <label className="cr-option-toggle">
              <input
                type="checkbox"
                checked={telemetry?.content_logging === true}
                onChange={(event) => update("content_logging", event.target.checked, "telemetry")}
              />
              <span>{t("reviewOcrContentLogging", "Include prompts and model responses in telemetry")}</span>
            </label>
          </fieldset>
          <fieldset className="cr-option-section" disabled={disabled}>
            <legend>
              <Braces size={14} />
              {t("reviewOcrJson", "Advanced JSON")}
            </legend>
            <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
              <summary>{t("reviewOcrEditJson", "Edit OCR configuration JSON")}</summary>
              {advanced && (
                <div className="cr-config-json">
                  <p className="cr-field-tip">
                    {t(
                      "reviewOcrJsonHint",
                      "Set provider and model, then edit the matching entry in providers or custom_providers. For legacy connections, use llm. Templates add missing fields without replacing saved values.",
                    )}
                  </p>
                  <div className="cr-config-actions">
                    <button
                      type="button"
                      className="cr-control"
                      disabled={!config}
                      onClick={() => insertProvider(false)}
                    >
                      {t("reviewOcrBuiltinTemplate", "Built-in provider template")}
                    </button>
                    <button
                      type="button"
                      className="cr-control"
                      disabled={!config}
                      onClick={() => insertProvider(true)}
                    >
                      {t("reviewOcrCustomTemplate", "Custom provider template")}
                    </button>
                    <button
                      type="button"
                      className="cr-control"
                      disabled={!config}
                      onClick={() => update("llm", { ...legacyFields, ...object(config?.llm) })}
                    >
                      {t("reviewOcrLegacyTemplate", "Legacy LLM template")}
                    </button>
                  </div>
                  <textarea
                    className="cr-mcp-editor"
                    aria-label={t("reviewOcrJson", "Advanced JSON")}
                    value={draft}
                    aria-invalid={!config}
                    rows={12}
                    spellCheck={false}
                    autoCapitalize="off"
                    maxLength={OCR_CONFIG_LIMIT}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  {!config && (
                    <p className="cr-field-tip" role="status">
                      {t("reviewOcrConfigInvalid", "Check the OCR configuration JSON and field values.")}
                    </p>
                  )}
                </div>
              )}
            </details>
          </fieldset>
          {(message || busy) && (
            <p className="cr-inline-message" role="status">
              {message || t("reviewErrorBusy", "A review is already running.")}
            </p>
          )}
        </div>
        <footer>
          <button
            type="button"
            className="cr-control"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("reviewReload", "Reload")}
          </button>
          <button type="submit" className="cr-control cr-primary" disabled={fieldDisabled || !dirty}>
            {t("reviewMcpSave", "Save configuration")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
