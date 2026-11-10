import type { SidebarWorkspace } from "@/hooks/useSidebarWorkspace";
import { lastRoutedModel, ModelRoutingStatus } from "./models/ModelRoutingStatus";
import { isVirtualSelection } from "@shared/session-model-display";
import { ExtensionStatusBar } from "./ExtensionStatusBar";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ExtensionUiRequest,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { hasDisplayableProcessMessage } from "@/lib/chat-process";
import { contextUsageFromMessages } from "@/lib/context-usage";
import { scaledChatFont } from "@/lib/chat-appearance";
import { CHAT_COLUMN_PADDING, CHAT_INPUT_RIGHT_PADDING, CHAT_MINIMAP_WIDTH } from "@/lib/chat-layout";
import { isAssistantFailure, isAssistantAborted, splitFinalAssistantBlocks } from "@/lib/message-display";
import { MessageView } from "./MessageView";
import { LiveProcessRows } from "./LiveProcessRows";
import { RunningTurnStatus } from "./RunningTurnStatus";
import { ProcessDetailsGroup } from "./ProcessDetailsGroup";
import { summarizeActivity } from "./chat/process-activity";
import { SessionProfiler } from "./SessionProfiler";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs, type ChatMinimapMessage } from "./ChatMinimap";
import { useTurnChangeFooters } from "./chat/TurnChangesTail";
import { ChatScrollbar } from "./chat/ChatScrollbar";
import type { WorkStepDisplay } from "@shared/work-step-display";
import { workStepDisplayPolicy } from "@shared/work-step-display";
import { SessionViewTabs, type SessionView } from "./SessionViewTabs";
import { ChatWidthHandles } from "./ChatWidthHandles";
import { ContextView } from "./context/ContextView";
import { TrajectoryView } from "./trajectory/TrajectoryView";
import { useAgentSession, type NoticeItem } from "@/hooks/useAgentSession";
import { useMcpSettingsCommand } from "@/hooks/useMcpSettingsRequests";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useObservedElementHeight } from "@/hooks/useObservedElementHeight";
import type { SessionPresentationStore } from "@/lib/session-presentation-store";
import { MessageRenderKeyRegistry, type MessageRenderRole } from "@/lib/message-render-key";
import { ToolMessageIndex } from "@/lib/tool-message-index";
import { withGeneratedImageReply } from "@/lib/generated-image-reply";
import { useI18n } from "@/i18n";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { skillInvocationCommandText } from "@shared/skill-invocation";
import { localizedExtensionConfirmCopy } from "@/lib/extension-ui-copy";
import serphiaMascot from "@/assets/serphia-mascot.png";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  workspace?: SidebarWorkspace;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void,
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  presentationStore: SessionPresentationStore;
  onSessionStatsPanelOpen?: () => void;
  onOpenFile?: (filePath: string) => void;
  thinkingExpansionStore: ThinkingExpansionStore;
  processDetailsExpansionStore: ThinkingExpansionStore;
  workStepDisplay: WorkStepDisplay;
}

function toMinimapMessage(message: AgentMessage | Partial<AgentMessage>): ChatMinimapMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content = message.content;
  if (message.role === "user") {
    const rawPreview =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ")
          : "";
    const preview = skillInvocationCommandText(rawPreview);
    return { role: "user", preview: preview.slice(0, 200), hasText: true };
  }
  const blocks = Array.isArray(content) ? splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks : [];
  const text = blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
  return {
    role: "assistant",
    preview: text.slice(0, 300),
    hasText: text.length > 0,
  };
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  if (isAssistantFailure(message as AssistantMessage) || isAssistantAborted(message as AssistantMessage)) return true;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some(
    (block) => block.type === "image" || (block.type === "text" && block.text.trim().length > 0),
  );
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean; omitFailure?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  if (options.omitFailure) {
    next.stopReason = undefined;
    next.errorMessage = undefined;
  }
  return next;
}

type AssistantRenderParts = {
  processBlocks: AssistantContentBlock[];
  processMessage: AssistantMessage | null;
  answerMessage: AssistantMessage | null;
};

function getAssistantRenderParts(
  cache: WeakMap<AssistantMessage, AssistantRenderParts>,
  message: AssistantMessage,
): AssistantRenderParts {
  const existing = cache.get(message);
  if (existing) return existing;
  const split = splitFinalAssistantBlocks(message);
  const created: AssistantRenderParts = {
    processBlocks: split.processBlocks,
    processMessage:
      split.processBlocks.length > 0
        ? withAssistantBlocks(message, split.processBlocks, { omitUsage: true, omitFailure: true })
        : null,
    answerMessage:
      split.answerBlocks.length > 0
        ? withAssistantBlocks(message, split.answerBlocks)
        : isAssistantFailure(message) || isAssistantAborted(message)
          ? withAssistantBlocks(message, [])
          : null,
  };
  cache.set(message, created);
  return created;
}

export function ChatWindow({
  session,
  newSessionCwd,
  workspace,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onBranchDataChange,
  onSystemPromptChange,
  presentationStore,
  onSessionStatsPanelOpen,
  onOpenFile,
  thinkingExpansionStore,
  processDetailsExpansionStore,
  workStepDisplay,
}: Props) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const chatRootRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const [sessionView, setSessionView] = useState<SessionView>("chat");
  useEffect(() => {
    setSessionView("chat");
  }, [session?.id]);
  // Promotion keeps this view mounted; selecting another session remounts it.
  const [draftPromotionFrom] = useState(() =>
    !session && newSessionCwd !== null ? `new:${newSessionCwd}` : undefined,
  );
  const messageRenderKeys = useRef(new MessageRenderKeyRegistry()).current;
  const assistantRenderParts = useRef(new WeakMap<AssistantMessage, AssistantRenderParts>()).current;

  const {
    sessionId: currentSessionId,
    loading,
    error,
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    toolPreset,
    thinkingLevel,
    retryInfo,
    forkingEntryId,
    isCompacting,
    compactResult,
    displayModel: displayModelValue,
    data,
    activeLeafId,
    contextUsage,
    sessionStats,
    systemPrompt,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    hasOlder,
    loadingOlder,
    notices,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    respondToExtensionUi,
    sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    messagesEndRef,
    liveContentEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleModelChange,
    refreshModels,
    cancelModelRefresh,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange,
    toolSelectionError,
    handleThinkingLevelChange,
    loadSlashCommands,
    loadOlder,
    loadDeferredContent,
  } = useAgentSession({
    session,
    newSessionCwd,
    onAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onBranchDataChange,
    onSystemPromptChange,
    presentationStore,
    onSessionStatsPanelOpen,
  });
  useMcpSettingsCommand(currentSessionId);
  const runningToolCallIds = useMemo(
    () => new Set(agentPhase?.kind === "running_tools" ? agentPhase.tools.map((tool) => tool.id) : []),
    [agentPhase],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      // Attaching while the agent runs is fine — send stays gated separately.
      chatInputRef?.current?.addFiles(files);
    },
    [chatInputRef],
  );

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);
  const minimapMessages = useMemo(() => messages.flatMap((message) => toMinimapMessage(message) ?? []), [messages]);
  const minimapStreamingMessage = useMemo(
    () => (streamState.streamingMessage ? toMinimapMessage(streamState.streamingMessage) : null),
    [streamState.streamingMessage],
  );
  const [toolIndex] = useState(() => new ToolMessageIndex());
  const toolMessageIndex = useMemo(() => toolIndex.build(messages), [messages, toolIndex]);
  const insertEditedContent = useCallback(
    (content: string) => chatInputRef?.current?.insertIfEmpty(content),
    [chatInputRef],
  );
  const olderHistorySentinelRef = useRef<HTMLDivElement | null>(null);
  const automaticHistoryPagesRef = useRef(0);

  useEffect(() => {
    automaticHistoryPagesRef.current = 0;
  }, [session?.id]);

  useEffect(() => {
    const sentinel = olderHistorySentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasOlder || loadingOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || automaticHistoryPagesRef.current >= 3) return;
        automaticHistoryPagesRef.current += 1;
        void loadOlder();
      },
      { root, rootMargin: "160px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder, loadingOlder, messages.length, scrollContainerRef]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  const showSessionViews = !isEmptyNew && messages.length > 0;
  const activeSessionView: SessionView = showSessionViews ? sessionView : "chat";
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const turnFooters = useTurnChangeFooters(messages, messageCwd, workspace?.homeDir, onOpenFile);
  const chatViewportHeight = useObservedElementHeight(scrollContainerRef);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // Reduce to a string so new messages only re-render the composer when the routed model changes.
  const routedModel = isVirtualSelection(modelList, displayModelValue) ? lastRoutedModel(messages) : null;
  const modelStatus = useMemo(() => <ModelRoutingStatus route={routedModel} />, [routedModel]);

  // A restored session has no live runtime usage until its RPC session starts;
  // derive the current context reading from the last settled assistant usage so
  // the composer dock can still show occupancy.
  const contextWindow = useMemo(() => {
    const liveWindow = contextUsage?.contextWindow ?? sessionStats?.contextUsage?.contextWindow ?? 0;
    if (liveWindow > 0) return liveWindow;
    const candidates: { provider: string; modelId: string }[] = [];
    if (displayModelValue) candidates.push(displayModelValue);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        candidates.push({ provider: message.provider, modelId: message.model });
        break;
      }
    }
    for (const candidate of candidates) {
      const model = modelList.find((entry) => entry.provider === candidate.provider && entry.id === candidate.modelId);
      if (model?.contextWindow !== undefined && model.contextWindow > 0) return model.contextWindow;
    }
    return null;
  }, [contextUsage, sessionStats, displayModelValue, messages, modelList]);
  const composerContextUsage = useMemo(
    () => contextUsage ?? contextUsageFromMessages(messages, contextWindow),
    [contextUsage, messages, contextWindow],
  );

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      welcome={isEmptyNew}
      onSend={handleSend}
      onAbort={isCompacting ? handleAbortCompaction : handleAbort}
      onSteer={agentRunning && !isCompacting ? handleSteer : undefined}
      onFollowUp={agentRunning && !isCompacting ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning && !isCompacting ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning || isCompacting}
      model={displayModelValue}
      modelStatus={modelStatus}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelCatalog={modelCatalog}
      modelRefreshing={modelRefreshing}
      onModelChange={handleModelChange}
      onModelsRefresh={refreshModels}
      onModelsRefreshCancel={cancelModelRefresh}
      isCompacting={isCompacting}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={messageCwd && (session || isNew) ? handleToolPresetChange : undefined}
      toolSelectionError={toolSelectionError}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      draftKey={session?.id ?? (newSessionCwd !== null ? `new:${newSessionCwd}` : undefined)}
      draftPromotionFrom={session ? draftPromotionFrom : undefined}
      cwd={session?.cwd ?? newSessionCwd}
      sessionStats={sessionStats}
      contextUsage={composerContextUsage}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return <div className="flex h-full items-center justify-center text-text-muted">Loading session...</div>;
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-red-400">{error}</div>;
  }

  return (
    <div
      ref={chatRootRef}
      className="chat-appearance-scope relative flex h-full flex-col overflow-hidden"
      style={{ background: "var(--assistant-bg)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center backdrop-blur-[1px]"
          style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{
                  transformOrigin: "center",
                  animationDelay: `${delay}s`,
                  borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)",
                }}
              />
            ))}
          </div>
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 18%, transparent))" }}
          >
            <rect
              x="28"
              y="44"
              width="84"
              height="60"
              rx="8"
              fill="color-mix(in srgb, var(--accent) 8%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 50%, transparent)"
              strokeWidth="1.8"
            />
            <path
              d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
              fill="color-mix(in srgb, var(--accent) 16%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 40%, transparent)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="96"
              cy="58"
              r="8"
              fill="color-mix(in srgb, var(--accent) 22%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 55%, transparent)"
              strokeWidth="1.6"
            />
            <g stroke="color-mix(in srgb, var(--accent) 45%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43" />
              <line x1="96" y1="70" x2="96" y2="73" />
              <line x1="84" y1="58" x2="81" y2="58" />
              <line x1="108" y1="58" x2="111" y2="58" />
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" />
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" />
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && <ExtensionDialog request={extensionDialog} onRespond={respondToExtensionUi} />}

      {extensionCustomUi && <ExtensionCustomPanel request={extensionCustomUi} onInput={sendExtensionCustomInput} />}

      {showSessionViews && <SessionViewTabs value={activeSessionView} onChange={setSessionView} />}

      {isEmptyNew ? (
        <div
          className="relative z-[1] flex min-h-0 flex-[1_1_0] flex-col items-center justify-end overflow-y-auto px-4 pt-8"
          aria-hidden={activeSessionView !== "chat" || undefined}
          inert={activeSessionView !== "chat" || undefined}
          style={{ display: activeSessionView === "chat" ? undefined : "none" }}
        >
          <div className="chat-content-column">
            <header className="chat-welcome" aria-labelledby="chat-welcome-title">
              <div className="chat-welcome-scene">
                <img
                  className="chat-welcome-mascot"
                  src={serphiaMascot}
                  alt=""
                  width={112}
                  height={112}
                  draggable={false}
                />
                <h1 className="chat-welcome-heading" id="chat-welcome-title">
                  {t("sessionWelcomeTagline", "Ideas,\nin motion.")
                    .split("\n")
                    .map((line, index) => (
                      <span className="chat-welcome-line" key={line}>
                        {index > 0 ? " " : ""}
                        {line}
                      </span>
                    ))}
                </h1>
              </div>
            </header>
            <NoticeShelf notices={notices} align="right" />
          </div>
        </div>
      ) : (
        <>
          <div
            id="session-view-chat"
            className="chat-conversation-enter relative z-[1] flex min-h-0 flex-[1_1_0] overflow-hidden"
            role="tabpanel"
            aria-label={t("sessionViewChat", "Chat")}
            aria-hidden={activeSessionView !== "chat" || undefined}
            inert={activeSessionView !== "chat" || undefined}
            style={{ display: activeSessionView === "chat" ? undefined : "none" }}
          >
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 0,
                right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
                zIndex: 40,
                padding: `0 ${CHAT_COLUMN_PADDING}px`,
                pointerEvents: "none",
              }}
            >
              <div className="chat-content-column">
                <NoticeShelf notices={notices} floating align="right" />
              </div>
            </div>
            <div ref={scrollContainerRef} className="chat-message-scroll relative z-[1] flex-1 overflow-y-auto">
              <div
                style={{
                  paddingLeft: CHAT_COLUMN_PADDING,
                  paddingRight: CHAT_COLUMN_PADDING,
                }}
              >
                <div className="chat-content-column">
                  {(hasOlder || loadingOlder) && (
                    <div
                      ref={olderHistorySentinelRef}
                      style={{ display: "flex", justifyContent: "center", padding: 8 }}
                    >
                      <button
                        type="button"
                        disabled={loadingOlder}
                        onClick={() => void loadOlder()}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 7,
                          background: "var(--bg-panel)",
                          color: "var(--text-muted)",
                          cursor: loadingOlder ? "default" : "pointer",
                          fontSize: scaledChatFont(11),
                          padding: "5px 10px",
                        }}
                      >
                        {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
                      </button>
                    </div>
                  )}
                  <ExtensionStatusBar statuses={extensionStatuses} />
                  <ExtensionWidgets widgets={aboveEditorWidgets} />

                  <div className="dsh-flow" data-chat-flow="">
                    {(() => {
                      let lastUserIdx = -1;
                      for (let i = messages.length - 1; i >= 0; i--) {
                        if (messages[i].role === "user") {
                          lastUserIdx = i;
                          break;
                        }
                      }

                      const timestampAssistantIndices = new Set<number>();
                      let foundAssistantInTurn = false;
                      for (let i = messages.length - 1; i >= 0; i--) {
                        if (messages[i].role === "user") {
                          foundAssistantInTurn = false;
                        } else if (messages[i].role === "assistant" && !foundAssistantInTurn) {
                          timestampAssistantIndices.add(i);
                          foundAssistantInTurn = true;
                        }
                      }

                      const visibleRefIndexByMessage = new Map<number, number>();
                      let refIdx = 0;
                      messages.forEach((msg, idx) => {
                        if (msg.role === "user" || msg.role === "assistant") {
                          visibleRefIndexByMessage.set(idx, refIdx++);
                        }
                      });

                      const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
                        messageRefs.current[refIndex] = el;
                        if (idx === lastUserIdx) {
                          (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
                        }
                      };

                      const renderMessage = (
                        idx: number,
                        options: {
                          attachRef?: boolean;
                          renderRole?: MessageRenderRole;
                          messageOverride?: AgentMessage;
                          showTimestamp?: boolean;
                          flowPart?: "response";
                          footer?: ReactNode;
                        } = {},
                      ): ReactNode => {
                        const msg = options.messageOverride ?? messages[idx];
                        const prevAssistantEntryId =
                          msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                            ? entryIds[idx - 1]
                            : undefined;
                        const isVisible = msg.role === "user" || msg.role === "assistant";
                        const currentRefIdx = visibleRefIndexByMessage.get(idx);
                        const renderRole = options.renderRole ?? "message";
                        const renderKey = messageRenderKeys.keyFor(messages[idx], entryIds[idx], renderRole);
                        const toolData = toolMessageIndex.get(messages[idx]);
                        let showTimestamp = false;
                        if (msg.role === "assistant") {
                          showTimestamp = timestampAssistantIndices.has(idx);
                          // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                          if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                            showTimestamp = false;
                          }
                        }
                        if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                        const view = (
                          <SessionProfiler key={renderKey} id="MessageView">
                            <MessageView
                              message={msg}
                              toolResults={toolData?.results}
                              runningToolCallIds={runningToolCallIds}
                              cwd={messageCwd}
                              home={workspace?.homeDir}
                              onOpenFile={onOpenFile}
                              entryId={entryIds[idx]}
                              onFork={
                                agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork
                              }
                              forking={forkingEntryId === entryIds[idx]}
                              onNavigate={agentRunning ? undefined : handleNavigate}
                              prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                              onEditContent={insertEditedContent}
                              onLoadDeferredContent={loadDeferredContent}
                              showTimestamp={showTimestamp}
                              thinkingExpansionStore={thinkingExpansionStore}
                              workStepDisplay={workStepDisplay}
                              hideCopy={renderRole === "process" || renderRole === "process-final"}
                              footer={options.footer}
                            />
                          </SessionProfiler>
                        );
                        if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
                        return (
                          <div
                            key={renderKey}
                            ref={attachVisibleRef(idx, currentRefIdx)}
                            data-flow-part={options.flowPart}
                          >
                            {view}
                          </div>
                        );
                      };

                      const rendered: ReactNode[] = [];
                      for (let idx = 0; idx < messages.length;) {
                        const msg = messages[idx];
                        if (msg.role !== "user") {
                          rendered.push(renderMessage(idx));
                          idx += 1;
                          continue;
                        }

                        const userIdx = idx;
                        let endIdx = userIdx + 1;
                        while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

                        const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                        if (finalAssistantIdx === -1) {
                          for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                            rendered.push(renderMessage(renderIdx));
                          }
                          idx = endIdx;
                          continue;
                        }

                        const isLiveTail =
                          (agentRunning || streamState.isStreaming) &&
                          endIdx === messages.length &&
                          userIdx === lastUserIdx;
                        if (isLiveTail) {
                          rendered.push(renderMessage(userIdx));
                          rendered.push(
                            <LiveProcessRows
                              key={`process-group-live:${entryIds[userIdx] ?? userIdx}`}
                              messages={messages}
                              userIdx={userIdx}
                              endIdx={endIdx}
                              entryId={entryIds[userIdx]}
                              expansionStore={processDetailsExpansionStore}
                              workStepDisplay={workStepDisplay}
                              renderMessage={renderMessage}
                            />,
                          );
                          idx = endIdx;
                          continue;
                        }

                        rendered.push(renderMessage(userIdx));

                        const processIndices: number[] = [];
                        for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
                          processIndices.push(processIdx);
                        }
                        const visibleProcessIndices = processIndices.filter((processIdx) =>
                          hasDisplayableProcessMessage(messages[processIdx]),
                        );
                        const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                        const finalParts = getAssistantRenderParts(assistantRenderParts, finalAssistant);
                        const finalProcessMessage = finalParts.processMessage;
                        const finalAnswerMessage = withGeneratedImageReply(
                          finalParts.answerMessage,
                          finalAssistant,
                          messages,
                          userIdx + 1,
                          endIdx,
                        );

                        const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
                        if (processCount > 0) {
                          const processGroupKey = `process-group:${messageRenderKeys.keyFor(
                            messages[userIdx],
                            entryIds[userIdx],
                            "message",
                          )}:${messageRenderKeys.keyFor(
                            messages[finalAssistantIdx],
                            entryIds[finalAssistantIdx],
                            "final",
                          )}`;
                          const processRefIdx =
                            visibleProcessIndices
                              .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
                              .find((value): value is number => typeof value === "number") ??
                            (finalAnswerMessage ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
                          const activityMessages = visibleProcessIndices.map((processIdx) => messages[processIdx]);
                          const processGroup = (
                            <ProcessDetailsGroup
                              stateKey={processGroupKey}
                              expansionStore={processDetailsExpansionStore}
                              policy={workStepDisplayPolicy(workStepDisplay)}
                              summary={summarizeActivity(
                                finalProcessMessage === undefined || finalProcessMessage === null
                                  ? activityMessages
                                  : [...activityMessages, finalProcessMessage],
                              )}
                              startedAt={(messages[userIdx] as AgentMessage & { timestamp?: number }).timestamp}
                              endedAt={finalAssistant.timestamp}
                              status={
                                isAssistantFailure(finalAssistant)
                                  ? "failed"
                                  : isAssistantAborted(finalAssistant)
                                    ? "aborted"
                                    : "completed"
                              }
                            >
                              {visibleProcessIndices.map((processIdx) =>
                                renderMessage(processIdx, { attachRef: false, renderRole: "process" }),
                              )}
                              {finalProcessMessage &&
                                renderMessage(finalAssistantIdx, {
                                  attachRef: false,
                                  renderRole: "process-final",
                                  messageOverride: finalProcessMessage,
                                  showTimestamp: false,
                                })}
                            </ProcessDetailsGroup>
                          );
                          rendered.push(
                            <div
                              key={processGroupKey}
                              data-flow-part="process"
                              ref={
                                processRefIdx === undefined
                                  ? undefined
                                  : (el) => {
                                      messageRefs.current[processRefIdx] = el;
                                    }
                              }
                            >
                              {processGroup}
                            </div>,
                          );
                        }

                        if (finalAnswerMessage) {
                          rendered.push(
                            renderMessage(finalAssistantIdx, {
                              renderRole: "final",
                              flowPart: "response",
                              messageOverride: finalAnswerMessage,
                              footer: turnFooters.get(userIdx),
                            }),
                          );
                        }
                        for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                          rendered.push(renderMessage(renderIdx));
                        }
                        idx = endIdx;
                      }
                      return rendered;
                    })()}

                    {streamState.isStreaming && streamState.streamingMessage && (
                      <SessionProfiler id="MessageView">
                        <MessageView
                          message={streamState.streamingMessage as AgentMessage}
                          isStreaming
                          cwd={messageCwd}
                          home={workspace?.homeDir}
                          onOpenFile={onOpenFile}
                          entryId="streaming"
                          thinkingExpansionStore={thinkingExpansionStore}
                          workStepDisplay={workStepDisplay}
                        />
                      </SessionProfiler>
                    )}

                    {agentRunning && <RunningTurnStatus messages={messages} />}
                  </div>

                  <div ref={liveContentEndRef} />

                  {agentRunning && <div data-run-spacer style={{ height: chatViewportHeight }} />}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>
            {isMobile ? null : (
              <SessionProfiler id="ChatMinimap">
                <ChatMinimap
                  messages={minimapMessages}
                  streamingMessage={minimapStreamingMessage}
                  scrollContainer={scrollContainerRef}
                  messageRefs={messageRefs}
                  historyTruncated={hasOlder}
                />
              </SessionProfiler>
            )}
          </div>
        </>
      )}

      {activeSessionView === "trajectory" && (
        <div
          id="session-view-trajectory"
          role="tabpanel"
          aria-label={t("sessionViewTrajectory", "Trajectory")}
          style={{ display: "flex", flex: 1, minHeight: 0 }}
        >
          <TrajectoryView
            messages={messages}
            entryIds={entryIds}
            runningToolCallIds={runningToolCallIds}
            streamingMessage={streamState.streamingMessage}
            agentRunning={agentRunning}
            agentPhase={agentPhase}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            modelNames={modelNames}
            sessionId={currentSessionId}
            leafId={activeLeafId}
          />
        </div>
      )}

      {activeSessionView === "context" && (
        <div
          id="session-view-context"
          role="tabpanel"
          aria-label={t("sessionViewContext", "Context")}
          style={{ display: "flex", flex: 1, minHeight: 0 }}
        >
          <ContextView
            messages={messages}
            contextUsage={composerContextUsage}
            sessionStats={sessionStats}
            systemPrompt={systemPrompt}
            toolNames={data?.toolNames}
            model={displayModelValue}
            modelNames={modelNames}
          />
        </div>
      )}

      <div
        ref={composerDockRef}
        className="chat-input-transition-dock relative z-[2] w-full flex-shrink-0 self-center"
        data-position={isEmptyNew ? "welcome" : "conversation"}
        aria-hidden={activeSessionView !== "chat" || undefined}
        inert={activeSessionView !== "chat" || undefined}
        style={{ display: activeSessionView === "chat" ? undefined : "none" }}
      >
        {!isEmptyNew && belowEditorWidgets.length > 0 && (
          <div
            style={{
              padding: `0 ${CHAT_COLUMN_PADDING}px`,
              paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
            }}
          >
            <div className="chat-content-column">
              <ExtensionWidgets widgets={belowEditorWidgets} />
            </div>
          </div>
        )}
        {chatInputElement}
      </div>

      <div
        className="chat-input-bottom-spacer"
        data-expanded={isEmptyNew ? "true" : "false"}
        aria-hidden="true"
        style={{ display: activeSessionView === "chat" ? undefined : "none" }}
      />

      <ChatScrollbar
        rootRef={chatRootRef}
        scrollContainer={scrollContainerRef}
        composerRef={composerDockRef}
        visible={!isMobile && activeSessionView === "chat" && !isEmptyNew}
      />

      <ChatWidthHandles
        rootRef={chatRootRef}
        visible={!isMobile && activeSessionView === "chat"}
        top={showSessionViews ? 38 : 0}
      />
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "5px 9px",
              borderBottom: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontSize: scaledChatFont(11),
              fontFamily: "var(--font-mono)",
            }}
          >
            {widget.key}
          </div>
          <pre
            style={{
              margin: 0,
              padding: "8px 9px",
              color: "var(--text-muted)",
              fontSize: scaledChatFont(12),
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono)",
            }}
          >
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({
  notices,
  floating = false,
  align = "left",
}: {
  notices: NoticeItem[];
  floating?: boolean;
  align?: "left" | "right";
}) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color =
          notice.type === "error"
            ? "#ef4444"
            : notice.type === "warning"
              ? "#d97706"
              : notice.type === "success"
                ? "#10b981"
                : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: 18,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                padding: "14px 0",
                minWidth: 0,
                maxWidth: "100%",
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (
    request: ExtensionDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
  const confirmCopy = request.method === "confirm" ? localizedExtensionConfirmCopy(request, t) : null;

  useEffect(() => {
    setValue(request.method === "editor" ? (request.prefill ?? "") : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: scaledChatFont(14), fontWeight: 650 }}>
            {confirmCopy?.title ?? request.title}
          </div>
          <div
            style={{
              marginTop: 3,
              color: "var(--text-dim)",
              fontSize: scaledChatFont(11),
              fontFamily: "var(--font-mono)",
            }}
          >
            {confirmCopy?.subtitle ?? t("extensionRequest", "Extension request")}
          </div>
        </div>

        <div style={{ padding: 14, maxHeight: "55vh", overflowY: "auto" }}>
          {request.method === "confirm" && (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: scaledChatFont(13),
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {confirmCopy?.message ?? request.message}
            </div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(request, { value: option })}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: scaledChatFont(13),
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: scaledChatFont(13),
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: scaledChatFont(13),
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t("cancel", "Cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {confirmCopy?.confirmLabel ?? t("confirm", "Confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {t("submit", "Submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function toTerminalKeyData(e: KeyboardEvent): string | null {
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    const ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(ch.charCodeAt(0) - 96);
    }
  }

  switch (e.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case " ":
      return " ";
    default:
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) return e.key;
      return null;
  }
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) =>
    Object.keys(segment.style).length > 0 ? (
      <span key={`${keyPrefix}-${index}`} style={segment.style}>
        {segment.text}
      </span>
    ) : (
      segment.text
    ),
  );
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    panelRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          const data = toTerminalKeyData(e);
          if (!data) return;
          e.preventDefault();
          e.stopPropagation();
          onInput(request, data);
        }}
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ color: "var(--text)", fontSize: scaledChatFont(13), fontWeight: 650 }}>Extension panel</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: scaledChatFont(12),
            }}
          >
            Close
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: scaledChatFont(13),
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
