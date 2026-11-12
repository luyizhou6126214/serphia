import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings2, X } from "lucide-react";
import type { ReviewConfigSnapshot, ReviewEngineStatus } from "@contract/code-review";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { reviewIssueText } from "./copy";
import { ReviewSelect } from "./ReviewSelect";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
export function ReviewConfigDialog({
  busy,
  onClose,
  onSaved,
}: {
  busy: boolean;
  onClose: () => void;
  onSaved: (status: ReviewEngineStatus) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<ReviewConfigSnapshot>();
  const [config, setConfig] = useState<Json>();
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
          setConfig(JSON.parse(result.value.text));
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

  const telemetry = object(config?.telemetry);
  const disabled = !snapshot || !config || loading || busy;
  const text = JSON.stringify(config, null, 2);
  const dirty = snapshot && snapshot.text !== text;

  function update(key: string, value: unknown, section?: string) {
    if (!config) return;
    const target = section ? { ...(object(config[section]) ?? {}) } : { ...config };
    if (value === undefined) delete target[key];
    else target[key] = value;
    setConfig(section ? { ...config, [section]: target } : target);
  }

  async function save() {
    if (disabled || !snapshot || !config || !dirty) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await call("codeReview.config.save", { revision: snapshot.revision, text });
      if (result.ok) {
        const { status, ...saved } = result.value;
        setSnapshot(saved);
        setConfig(JSON.parse(saved.text));
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
          <fieldset className="cr-option-section" disabled={disabled}>
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
                  disabled={disabled}
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
                  disabled={disabled}
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
          <button type="submit" className="cr-control cr-primary" disabled={disabled || !dirty}>
            {t("reviewMcpSave", "Save configuration")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
