import { lazy, Suspense, useRef, useState } from "react";
import { FolderOpen, Layers, PanelRightClose, PanelRightOpen, Presentation, SquarePen } from "lucide-react";
import { PresentationChatWindow } from "./conversation/PresentationChatWindow";
import type { ChatInputHandle } from "./conversation/ChatInput";
import { SessionPresentationStore } from "@/lib/session-presentation-store";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { useI18n } from "@/i18n";
import { usePresentationWorkflow } from "./usePresentationWorkflow";

const PowerPointEditor = lazy(() => import("./PowerPointEditor"));

export function PresentationSkillWorkspace({
  cwd,
  hidden,
  openNative,
}: {
  cwd: string | null;
  hidden: boolean;
  openNative: () => void;
}) {
  const { t } = useI18n();
  const studio = usePresentationWorkflow(cwd, !hidden);
  const [closed, setClosed] = useState(false);
  const [chosen, setChosen] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [presentationStore] = useState(() => new SessionPresentationStore());
  const [thinking] = useState(() => new ThinkingExpansionStore());
  const [details] = useState(() => new ThinkingExpansionStore());
  const chatInput = useRef<ChatInputHandle>(null);
  const file = studio.files.find((item) => item.path === (editingPath ?? chosen)) ?? studio.files[0];
  const directory = studio.workflow?.directory;
  return (
    <section className="ppt-workspace ppt-skill-workspace" hidden={hidden} aria-label={t("pptTitle", "PPT Studio")}>
      <header className="ppt-header">
        <div className="ppt-workspace-name">
          <Presentation aria-hidden="true" />
          <h1>{t("pptTitle", "PPT Studio")}</h1>
        </div>
        {studio.files.length > 1 && (
          <select
            aria-label={t("pptSelectDeck", "Select a deck")}
            disabled={!!editingPath}
            value={file?.path ?? ""}
            onChange={(event) => setChosen(event.target.value)}
          >
            {studio.files.map((item) => (
              <option key={item.path} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <div className="ppt-controls ppt-header-actions">
          <button type="button" className="ppt-button" disabled={!!editingPath} onClick={openNative}>
            {t("pptNativeEditor", "Local decks")}
          </button>
          <button
            type="button"
            className="ppt-icon"
            aria-label={t("pptTogglePanel", "Toggle studio panel")}
            aria-expanded={!closed}
            onClick={() => setClosed(!closed)}
          >
            {closed ? <PanelRightOpen /> : <PanelRightClose />}
          </button>
        </div>
      </header>
      {studio.error && (
        <div className="ppt-notice" role="alert">
          <span>{studio.error}</span>
          <button className="ppt-button" onClick={() => studio.setError("")}>
            {t("pptDismiss", "Dismiss")}
          </button>
        </div>
      )}
      <div className={`ppt-editor ppt-skill-editor${closed ? " panel-closed" : ""}`}>
        <main className="ppt-deck-editor">
          {studio.confirmationPort && !editingPath ? (
            <iframe
              className="ppt-design-confirmation"
              title={t("pptDesignConfirmation", "Confirm presentation design")}
              src={`http://127.0.0.1:${studio.confirmationPort}/`}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : file && studio.workflow ? (
            <Suspense fallback={<p role="status">{t("pptLoading", "Loading presentations…")}</p>}>
              <PowerPointEditor
                key={file.path}
                file={file}
                sessionId={studio.workflow.sessionId}
                onEditing={setEditingPath}
              />
            </Suspense>
          ) : studio.designConfirmed ? (
            <div className="ppt-empty-state" role="status">
              <Layers size={32} />
              <p>{t("pptDesignConfirmed", "Design confirmed. Preparing your presentation…")}</p>
            </div>
          ) : (
            <div className="ppt-empty-state">
              <Layers size={32} />
              <h2>{t("pptSkillEmpty", "A canvas for your next story")}</h2>
              <p>
                {t(
                  "pptSkillEmptyHint",
                  "Describe your presentation in the chat. The exported deck will open here for editing.",
                )}
              </p>
            </div>
          )}
        </main>
        <aside
          className="ppt-sidepanel ppt-skill-sidepanel"
          aria-label={t("pptConversation", "Conversation")}
          hidden={closed}
        >
          <header className="ppt-column-heading ppt-conversation-heading">
            <h2>{t("pptConversation", "Conversation")}</h2>
            {file && (
              <button
                className="ppt-icon"
                title={t("pptExportFolder", "Show in folder")}
                aria-label={t("pptExportFolder", "Show in folder")}
                onClick={() => void window.piBridge.showItemInFolder(file.path)}
              >
                <Presentation />
              </button>
            )}
            {directory && (
              <button
                className="ppt-icon"
                title={t("pptOpenWorkspace", "Open workflow folder")}
                aria-label={t("pptOpenWorkspace", "Open workflow folder")}
                onClick={() => void window.piBridge.showItemInFolder(directory)}
              >
                <FolderOpen />
              </button>
            )}
            {studio.session && (
              <button
                className="ppt-icon"
                disabled={!!editingPath}
                title={t("pptNew", "New deck")}
                aria-label={t("pptNew", "New deck")}
                onClick={() => {
                  setChosen("");
                  studio.newDeck();
                }}
              >
                <SquarePen />
              </button>
            )}
          </header>
          <div className="ppt-session">
            {studio.restoring ? (
              <p role="status">{t("pptStartingSession", "Starting session…")}</p>
            ) : (
              <PresentationChatWindow
                key={studio.draft}
                session={studio.session}
                newSessionCwd={cwd ?? ""}
                createSession={studio.createSession}
                newDraftKey={`ppt-draft:${cwd ?? "local"}`}
                onSessionCreated={studio.promote}
                presentationStore={presentationStore}
                thinkingExpansionStore={thinking}
                processDetailsExpansionStore={details}
                chatInputRef={chatInput}
                onOpenFile={(file) => void window.piBridge.showItemInFolder(file)}
              />
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
