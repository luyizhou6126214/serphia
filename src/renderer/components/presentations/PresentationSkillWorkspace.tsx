import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  FolderOpen,
  Layers,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Presentation,
  Settings2,
} from "lucide-react";
import { ChatWindow } from "../ChatWindow";
import type { ChatInputHandle } from "../ChatInput";
import { SessionPresentationStore } from "@/lib/session-presentation-store";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { useI18n } from "@/i18n";
import { usePresentationWorkflow } from "./usePresentationWorkflow";

gsap.registerPlugin(useGSAP);
export function PresentationSkillWorkspace({
  cwd,
  hidden,
  openNative,
}: {
  cwd: string | null;
  hidden: boolean;
  openNative: () => void;
}) {
  const { t, language } = useI18n();
  const studio = usePresentationWorkflow(cwd);
  const [tab, setTab] = useState<"chat" | "setup" | "artifacts">("setup");
  const [brief, setBrief] = useState("");
  const [source, setSource] = useState("");
  const [count, setCount] = useState(6);
  const [pagePath, setPagePath] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [follow, setFollow] = useState(true);
  const [presentationStore] = useState(() => new SessionPresentationStore());
  const [thinking] = useState(() => new ThinkingExpansionStore());
  const [details] = useState(() => new ThinkingExpansionStore());
  const canvas = useRef<HTMLDivElement>(null);
  const chatInput = useRef<ChatInputHandle>(null);
  const pages = studio.artifacts.pages;
  const latestPage = pages.reduce<(typeof pages)[number] | undefined>(
    (latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest),
    undefined,
  );
  const page = follow ? latestPage : (pages.find((item) => item.path === pagePath) ?? pages[0]);
  useEffect(() => {
    if (studio.session) setTab("chat");
  }, [studio.session]);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        if (canvas.current) gsap.from(canvas.current, { opacity: 0.5, y: 5, duration: 0.28, ease: "power2.out" });
      });
      return () => media.revert();
    },
    { scope: canvas, dependencies: [page?.revision], revertOnUpdate: true },
  );
  return (
    <section className="ppt-workspace ppt-skill-workspace" hidden={hidden} aria-label={t("pptTitle", "PPT Studio")}>
      <header className="ppt-header">
        <div className="ppt-workspace-name">
          <Presentation />
          <div>
            <h1>{t("pptTitle", "PPT Studio")}</h1>
            <span>{t("pptSkillWorkflow", "Presentation workspace")}</span>
          </div>
        </div>
        <div className="ppt-controls ppt-header-actions">
          <button type="button" className="ppt-button" onClick={openNative}>
            {t("pptNativeEditor", "Native editor")}
          </button>
          <button
            type="button"
            className="ppt-icon"
            aria-label={t("pptTogglePanel", "Toggle studio panel")}
            onClick={() => setClosed(!closed)}
          >
            {closed ? <PanelRightOpen /> : <PanelRightClose />}
          </button>
        </div>
      </header>
      {studio.error && (
        <div className="ppt-notice" role="alert">
          <span>{studio.error}</span>
          <button className="ppt-button" type="button" onClick={studio.dismissError}>
            {t("pptDismiss", "Dismiss")}
          </button>
        </div>
      )}
      <div className={`ppt-editor ppt-skill-editor${closed ? " panel-closed" : ""}`}>
        <nav className="ppt-slide-list" aria-label={t("pptSlides", "Slides")}>
          <div className="ppt-column-heading">
            <h2>{t("pptSlides", "Slides")}</h2>
            <span>{pages.length}</span>
          </div>
          <ol className="ppt-thumbnails">
            {pages.map((item, index) => (
              <li key={item.path}>
                <button
                  className="ppt-thumbnail"
                  type="button"
                  aria-current={item.path === page?.path ? "page" : undefined}
                  onClick={() => {
                    setPagePath(item.path);
                    setFollow(false);
                  }}
                >
                  <img className="ppt-thumb-canvas" src={item.image} alt="" />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.name}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <main className="ppt-center">
          <div className="ppt-toolbar">
            <span className="ppt-muted">{t("pptSkillCanvasHint", "Live SVG source · native PPTX output")}</span>
            <button
              type="button"
              className="ppt-button ppt-header-actions"
              aria-pressed={follow}
              onClick={() => setFollow(!follow)}
            >
              {t("pptFollowLive", "Follow live")}
            </button>
          </div>
          <div className="ppt-stage">
            {page ? (
              <div className="ppt-paper ppt-skill-paper" ref={canvas}>
                <img src={page.image} alt={page.name} />
              </div>
            ) : (
              <div className="ppt-empty-state">
                <Layers size={32} />
                <h2>{t("pptSkillEmpty", "A canvas for your next story")}</h2>
                <p>{t("pptSkillEmptyHint", "Start a conversation. Pages appear here as the agents write them.")}</p>
              </div>
            )}
          </div>
          <footer className="ppt-stage-footer">
            <span>{page?.name ?? t("pptWaitingOutput", "Waiting for page output")}</span>
          </footer>
        </main>
        <aside className="ppt-sidepanel ppt-skill-sidepanel" hidden={closed}>
          <div className="ppt-panel-tabs">
            <button type="button" aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
              <MessageSquare />
              {t("pptConversation", "Conversation")}
            </button>
            <button type="button" aria-pressed={tab === "setup"} onClick={() => setTab("setup")}>
              <Settings2 />
              {t("pptSkillSetup", "Brief")}
            </button>
            <button type="button" aria-pressed={tab === "artifacts"} onClick={() => setTab("artifacts")}>
              <FolderOpen />
              {t("pptArtifacts", "Artifacts")}
            </button>
          </div>
          <div className="ppt-session" hidden={tab !== "chat"}>
            {studio.session ? (
              <ChatWindow
                key={studio.session.id}
                session={studio.session}
                newSessionCwd={cwd}
                presentationStore={presentationStore}
                thinkingExpansionStore={thinking}
                processDetailsExpansionStore={details}
                workStepDisplay="verbose"
                chatInputRef={chatInput}
                initialPrompt={studio.workflow?.prompt}
                onOpenFile={(file) => void window.piBridge.showItemInFolder(file)}
              />
            ) : (
              <div className="ppt-empty-state">
                <MessageSquare size={28} />
                <p>
                  {t(
                    "pptStartSessionHint",
                    "Describe your presentation to start. Continue, approve or stop directly in this conversation.",
                  )}
                </p>
                <button className="ppt-button" type="button" onClick={() => setTab("setup")}>
                  {t("pptSkillSetup", "Brief")}
                </button>
              </div>
            )}
          </div>
          <div className="ppt-panel-content ppt-skill-setup" hidden={tab !== "setup"}>
            <div className="ppt-studio-intro">
              <h2>{t("pptStudioHeading", "From an idea to a presentation.")}</h2>
              <p>
                {t("pptFullSkillHint", "Describe your audience and story, then refine the result in conversation.")}
              </p>
            </div>
            <form
              className="ppt-fields"
              onSubmit={(event) => {
                event.preventDefault();
                setTab("chat");
                void studio.start(brief, source, count, language);
              }}
            >
              <label className="ppt-field">
                {t("pptBrief", "Brief")}
                <textarea
                  required
                  rows={4}
                  maxLength={2000}
                  value={brief}
                  disabled={studio.busy}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder={t("pptBriefHint", "Example: A 6-slide quarterly review for the leadership team.")}
                />
              </label>
              <label className="ppt-field">
                {t("pptSource", "Source material")}
                <textarea
                  rows={3}
                  maxLength={16000}
                  value={source}
                  disabled={studio.busy}
                  onChange={(event) => setSource(event.target.value)}
                />
              </label>
              <label className="ppt-field ppt-count">
                {t("pptPageCount", "Page count")}
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </label>
              <button className="ppt-button is-primary" type="submit" disabled={studio.busy || !brief.trim()}>
                {studio.busy ? t("pptStartingSession", "Starting session…") : t("pptStartSkill", "Start presentation")}
              </button>
            </form>
          </div>
          <div className="ppt-panel-content ppt-skill-outputs" hidden={tab !== "artifacts"}>
            <h2>{t("pptNativeOutput", "Native PowerPoint files")}</h2>
            <p className="ppt-muted">
              {t("pptNativeOutputHint", "Open the exported presentation to edit its contents in PowerPoint.")}
            </p>
            {studio.artifacts.exports.map((file) => (
              <button
                key={file.path}
                className="ppt-artifact-file"
                type="button"
                onClick={() => void window.piBridge.showItemInFolder(file.path)}
              >
                <Presentation size={20} />
                <span>
                  <strong>{file.name}</strong>
                  <small>{new Date(file.updatedAt).toLocaleString()}</small>
                </span>
                <FolderOpen size={15} />
              </button>
            ))}
            {!studio.artifacts.exports.length && (
              <p className="ppt-muted">{t("pptNoExports", "Exported PPTX files appear here after validation.")}</p>
            )}
            {studio.workflow && (
              <button
                className="ppt-button"
                type="button"
                onClick={() => void window.piBridge.showItemInFolder(studio.workflow!.directory)}
              >
                <FolderOpen />
                {t("pptOpenWorkspace", "Open workflow folder")}
              </button>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
