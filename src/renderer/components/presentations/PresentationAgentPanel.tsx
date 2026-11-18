import { useRef, useState } from "react";
import { FilePlus2, Sparkles, Square } from "lucide-react";
import { MAX_SOURCE_LENGTH } from "@contract/presentations";
import { useI18n } from "@/i18n";
import type { usePresentationAgent } from "./usePresentationAgent";
import { PresentationActivity } from "./PresentationActivity";

type Agent = ReturnType<typeof usePresentationAgent>;
type Props = {
  cwd: string | null;
  agent: Agent;
  startPages: () => void;
  review: () => void;
  openModels: () => void;
};

export function PresentationAgentPanel({ cwd, agent, startPages, review, openModels }: Props) {
  const { language, t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState("");
  const [count, setCount] = useState(6);
  const [sourceError, setSourceError] = useState(false);
  const [tab, setTab] = useState<"outline" | "activity" | null>(null);
  const [expanded, setExpanded] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const outline = agent.outline;
  const busy = agent.phase !== "idle";
  const activeTab = tab ?? (busy || agent.slides.length > 0 ? "activity" : "outline");
  const layouts = [
    ["cover", t("pptCover", "Cover")],
    ["content", t("pptContent", "Content")],
    ["data", t("pptData", "Data")],
    ["closing", t("pptClosing", "Closing")],
  ] as const;

  return (
    <div className="ppt-agent-panel">
      <div className="ppt-studio-intro">
        <span className="ppt-native-badge">PPTX · {t("pptEditable", "Editable")}</span>
        <h2>{t("pptStudioHeading", "From an idea to a presentation.")}</h2>
        <p>{t("pptStudioHint", "Shape the story, watch it take form, refine every detail.")}</p>
      </div>
      {(outline || agent.events.length > 0) && (
        <div className="ppt-agent-tabs">
          <button type="button" aria-pressed={activeTab === "outline"} onClick={() => setTab("outline")}>
            {t("pptStory", "Outline & brief")}
          </button>
          <button type="button" aria-pressed={activeTab === "activity"} onClick={() => setTab("activity")}>
            {t("pptActivity", "Activity")}
            {busy && <span className="ppt-live-dot" />}
          </button>
        </div>
      )}
      {activeTab === "activity" && <PresentationActivity agent={agent} />}
      <div hidden={activeTab !== "outline"} className="ppt-agent-configuration">
        {outline ? (
          <>
            <div className="ppt-agent-progress">
              <strong>
                {agent.completedCount}/{outline.pages.length}
              </strong>
              <span>
                {agent.phase === "slides" ? t("pptDesigning", "Designing slides…") : t("pptSlides", "Slides")}
              </span>
            </div>
            <progress max={outline.pages.length} value={agent.completedCount} aria-label={t("pptSlides", "Slides")} />
            <fieldset className="ppt-fields">
              <label className="ppt-field">
                {t("pptOutlineName", "Deck title")}
                <input
                  value={outline.title}
                  disabled={busy || agent.slides.length > 0}
                  maxLength={120}
                  onChange={(event) => agent.setOutline({ ...outline, title: event.currentTarget.value })}
                />
              </label>
              <label className="ppt-field ppt-color-field">
                {t("pptAccent", "Accent color")}
                <input
                  type="color"
                  disabled={busy || agent.slides.length > 0}
                  value={outline.accent}
                  onChange={(event) => agent.setOutline({ ...outline, accent: event.currentTarget.value })}
                />
              </label>
              <ol className="ppt-outline">
                {outline.pages.map((page, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="ppt-outline-toggle"
                      aria-expanded={expanded === index}
                      onClick={() => setExpanded(expanded === index ? -1 : index)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{page.title}</strong>
                      <span>{expanded === index ? "−" : "+"}</span>
                    </button>
                    <div className="ppt-outline-fields" hidden={expanded !== index}>
                      <label className="ppt-field">
                        {t("pptSlideTitle", "Slide title")}
                        <input
                          value={page.title}
                          disabled={busy || agent.slides.length > 0}
                          maxLength={120}
                          aria-label={`${t("pptSlideTitle", "Slide title")} ${index + 1}`}
                          onChange={(event) => {
                            const { value } = event.currentTarget;
                            agent.setOutline({
                              ...outline,
                              pages: outline.pages.map((item, row) =>
                                row === index ? { ...item, title: value } : item,
                              ),
                            });
                          }}
                        />
                      </label>
                      <label className="ppt-field">
                        {t("pptSummary", "Page brief")}
                        <textarea
                          rows={2}
                          disabled={busy || agent.slides.length > 0}
                          maxLength={120}
                          value={page.summary}
                          onChange={(event) => {
                            const { value } = event.currentTarget;
                            agent.setOutline({
                              ...outline,
                              pages: outline.pages.map((item, row) =>
                                row === index ? { ...item, summary: value } : item,
                              ),
                            });
                          }}
                        />
                      </label>
                      <select
                        aria-label={t("pptSlideLayout", "Slide layout")}
                        value={page.layout}
                        disabled={busy || agent.slides.length > 0}
                        onChange={(event) => {
                          const option = layouts.find(([id]) => id === event.currentTarget.value);
                          if (option)
                            agent.setOutline({
                              ...outline,
                              pages: outline.pages.map((item, row) =>
                                row === index ? { ...item, layout: option[0] } : item,
                              ),
                            });
                        }}
                      >
                        {layouts.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ol>
            </fieldset>
            <div className="ppt-controls">
              {agent.completedCount < outline.pages.length && (
                <button
                  type="button"
                  className="ppt-button is-primary"
                  onClick={() => {
                    setTab("activity");
                    startPages();
                  }}
                  disabled={
                    busy ||
                    !outline.title.trim() ||
                    outline.pages.some((page) => !page.title.trim() || !page.summary.trim())
                  }
                >
                  <Sparkles />
                  {agent.slides.length ? t("pptResume", "Continue generation") : t("pptDesign", "Generate slides")}
                </button>
              )}
              {agent.slides.length > 0 && (
                <button type="button" className="ppt-button" onClick={review}>
                  {t("pptReviewDraft", "Review draft")}
                </button>
              )}
              <button
                type="button"
                className="ppt-button"
                disabled={busy}
                onClick={() => {
                  setTab(null);
                  agent.reset();
                }}
              >
                {t("pptResetDraft", "New brief")}
              </button>
            </div>
          </>
        ) : (
          <form
            className="ppt-fields"
            onSubmit={(event) => {
              event.preventDefault();
              if (prompt.trim()) {
                setTab("activity");
                void agent.generateOutline({ cwd, language, prompt: prompt.trim(), source, count });
              }
            }}
          >
            <label className="ppt-field">
              {t("pptBrief", "Brief")}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                maxLength={2000}
                rows={5}
                required
                disabled={busy}
                placeholder={t("pptBriefHint", "Example: A 6-slide quarterly review for the leadership team.")}
              />
            </label>
            <label className="ppt-field">
              {t("pptSource", "Source material")}
              <textarea
                value={source}
                rows={4}
                maxLength={MAX_SOURCE_LENGTH}
                disabled={busy}
                onChange={(event) => {
                  setSource(event.currentTarget.value);
                  setSourceError(false);
                }}
                placeholder={t("pptSourceHint", "Paste relevant text or add TXT, Markdown, or CSV.")}
              />
            </label>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,.markdown,.csv"
              hidden
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                try {
                  if (!/\.(txt|md|markdown|csv)$/iu.test(file.name) || file.size > MAX_SOURCE_LENGTH * 4)
                    throw new Error();
                  const text = [source, await file.text()].filter(Boolean).join("\n\n");
                  if (text.length > MAX_SOURCE_LENGTH) throw new Error();
                  setSource(text);
                  setSourceError(false);
                } catch {
                  setSourceError(true);
                }
              }}
            />
            {sourceError && (
              <p className="ppt-error" role="alert">
                {t("pptSourceError", "Use TXT, Markdown, or CSV and keep total source text within 16,000 characters.")}
              </p>
            )}
            <div className="ppt-controls">
              <button type="button" className="ppt-button" disabled={busy} onClick={() => fileInput.current?.click()}>
                <FilePlus2 />
                {t("pptAttach", "Add text file")}
              </button>
              <label className="ppt-field ppt-count">
                {t("pptPageCount", "Page count")}
                <select value={count} disabled={busy} onChange={(event) => setCount(Number(event.currentTarget.value))}>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index}>{index + 1}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" className="ppt-button is-primary" disabled={busy || !prompt.trim()}>
              <Sparkles />
              {agent.phase === "outline" ? t("pptOutlining", "Drafting outline…") : t("pptOutline", "Draft outline")}
            </button>
            <p className="ppt-muted">{t("pptDefaultModel", "Uses the configured Pi model.")}</p>
          </form>
        )}
      </div>
      {activeTab === "activity" && !busy && (
        <div className="ppt-controls ppt-agent-next">
          <button type="button" className="ppt-button" onClick={() => setTab("outline")}>
            {outline ? t("pptEditOutline", "Review outline") : t("pptBrief", "Brief")}
          </button>
          {outline && agent.completedCount < outline.pages.length && (
            <button
              type="button"
              className="ppt-button is-primary"
              onClick={startPages}
              disabled={
                !outline.title.trim() || outline.pages.some((page) => !page.title.trim() || !page.summary.trim())
              }
            >
              {agent.slides.length ? t("pptContinue", "Continue generation") : t("pptGeneratePages", "Generate slides")}
            </button>
          )}
        </div>
      )}
      {busy && (
        <button type="button" className="ppt-button" onClick={agent.stop}>
          <Square />
          {t("pptStop", "Stop")}
        </button>
      )}
      {agent.error && (
        <div className="ppt-error" role="alert">
          <p>
            {agent.error.noModel
              ? t("pptNoModel", "Configure a language model in Settings → Models to generate slides.")
              : agent.error.message}
          </p>
          {agent.error.noModel && (
            <button type="button" className="ppt-button" onClick={openModels}>
              {t("pptOpenModels", "Open model settings")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
