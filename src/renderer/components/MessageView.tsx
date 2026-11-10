import { Check, ChevronDown, Copy, GitFork, History, LoaderCircle, Pencil, Box } from "lucide-react";
import { formatTime } from "@/lib/message-metadata";
import { memo, useState, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { ReplyImage } from "./ReplyImage";
import { DeferredContentActions } from "./DeferredContentActions";
import { AssistantOutcome } from "./AssistantOutcome";
import { getToolResultDisplayText } from "@/lib/tool-result-display";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { hasRenderableAssistantMessage, isEmptyTextBlock, isEmptyThinkingBlock } from "@/lib/message-display";
import { getUserBubbleStyle } from "@/lib/channel-message-style";
import { CHANNEL_ATTACHMENT_PROMPT_PLACEHOLDER, channelAttachmentCopyText } from "@shared/channel-message";
import { parseSkillInvocation, skillInvocationCommandText, type SkillInvocation } from "@shared/skill-invocation";
import { useI18n } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { workStepDisplayPolicy, type WorkStepDisplay } from "@shared/work-step-display";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";
import { ReasoningRow } from "./chat/ReasoningRow";
import { ToolCallRow, browserResultSummary, browserTabIdFromResult, isBrowserToolName } from "./chat/ToolCallRow";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  runningToolCallIds?: ReadonlySet<string>;
  cwd?: string;
  home?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingExpansionStore?: ThinkingExpansionStore;
  workStepDisplay?: WorkStepDisplay;
  hideCopy?: boolean;
  /** Rendered inside the assistant body, above the action row. */
  footer?: ReactNode;
}

export const MessageView = memo(function MessageView({
  message,
  isStreaming,
  toolResults,
  runningToolCallIds,
  cwd,
  home,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  showTimestamp,
  onLoadDeferredContent,
  thinkingExpansionStore,
  workStepDisplay,
  hideCopy,
  footer,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
        onLoadDeferredContent={onLoadDeferredContent}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessageView
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        toolResults={toolResults}
        runningToolCallIds={runningToolCallIds}
        cwd={cwd}
        home={home}
        onOpenFile={onOpenFile}
        showTimestamp={showTimestamp}
        onLoadDeferredContent={onLoadDeferredContent}
        entryId={entryId}
        thinkingExpansionStore={thinkingExpansionStore}
        workStepDisplay={workStepDisplay}
        hideCopy={hideCopy}
        footer={footer}
      />
    );
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return (
        <>
          <CompactionMessageView message={message as CustomMessage} />
          <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        </>
      );
    }
    return (
      <CustomMessageView
        message={message as CustomMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        onLoadDeferredContent={onLoadDeferredContent}
      />
    );
  }
  return null;
});

function MessageActionButton({
  label,
  onClick,
  disabled,
  active,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`dsh-message-action ${className}`.trim()}
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      data-active={active || undefined}
    >
      {children}
    </button>
  );
}

function UserMessageView({
  message,
  cwd,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  onLoadDeferredContent,
}: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(false);
  const { copied, copy } = useCopyFeedback();

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");
  const skillInvocation = useMemo(() => parseSkillInvocation(content), [content]);

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image" && !b.deferredContent);

  const isChannelAttachmentPlaceholder = !!message.channelSource && content === CHANNEL_ATTACHMENT_PROMPT_PLACEHOLDER;
  const attachmentCopyContent = isChannelAttachmentPlaceholder
    ? channelAttachmentCopyText(message.channelAttachments, imageBlocks)
    : "";
  const visibleContent = isChannelAttachmentPlaceholder
    ? imageBlocks.length > 0
      ? ""
      : attachmentCopyContent || t("channelAttachment", "Attachment")
    : skillInvocation
      ? (skillInvocation.userMessage ?? "")
      : content;
  const skillCommand = skillInvocation ? skillInvocationCommandText(content) : null;
  const copyableContent = isChannelAttachmentPlaceholder ? attachmentCopyContent : (skillCommand ?? visibleContent);
  const editableContent = skillCommand ?? content;

  const time = formatTime(message.timestamp);
  const messageSource = message.channelSource ?? "local";
  const bubbleStyle = getUserBubbleStyle(message.channelSource, isDark);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => void copy(copyableContent);

  return (
    <div
      className="chat-message chat-message-user dsh-user-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="dsh-user-stack">
        {imageBlocks.length > 0 && (
          <div className="dsh-user-attachments">
            {imageBlocks.map((img, i) => {
              // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
              // pi-ai on-disk format uses flat {data, mimeType} — handle both
              const flat = img as unknown as { data?: string; mimeType?: string };
              const src = img.source
                ? img.source.type === "base64"
                  ? `data:${img.source.media_type};base64,${img.source.data}`
                  : (img.source.url ?? "")
                : flat.data
                  ? `data:${flat.mimeType};base64,${flat.data}`
                  : "";
              return <img key={i} className="dsh-user-image" src={src} alt="" />;
            })}
          </div>
        )}
        <div
          className="dsh-user-bubble"
          data-message-source={messageSource}
          style={
            messageSource === "local"
              ? undefined
              : { background: bubbleStyle.background, color: bubbleStyle.foreground }
          }
        >
          {skillInvocation && (
            <SkillInvocationView
              invocation={skillInvocation}
              cwd={cwd}
              onOpenFile={onOpenFile}
              followedByContent={imageBlocks.length > 0 || Boolean(visibleContent)}
            />
          )}
          {visibleContent && (
            <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile} renderReferences>
              {visibleContent}
            </MarkdownBody>
          )}
          <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        </div>
      </div>

      {/* Action row: MessageIconActions parity — copy, branch actions, clock. */}
      <div className="dsh-user-actions">
        <div
          className="dsh-message-actions"
          style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
        >
          <MessageActionButton
            label={
              !copyableContent
                ? t("nothingToCopy", "Nothing to copy")
                : copied
                  ? t("copyMessageCopied", "Copied")
                  : t("copyMessage", "Copy message")
            }
            onClick={copyContent}
            disabled={!copyableContent}
            active={copied}
          >
            {copied ? (
              <Check size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Copy size={15} strokeWidth={1.6} aria-hidden="true" />
            )}
          </MessageActionButton>
        </div>
        {(canFork || canNavigate) && (
          <div
            className="dsh-message-actions"
            style={{ opacity: hovered || forking ? 1 : 0, pointerEvents: hovered || forking ? "auto" : "none" }}
          >
            {canNavigate && (
              <MessageActionButton
                label={t("editMessage", "Edit from here — branches within this session")}
                onClick={() => {
                  onNavigate!(prevAssistantEntryId!);
                  onEditContent?.(editableContent);
                }}
              >
                <Pencil size={15} strokeWidth={1.6} aria-hidden="true" />
              </MessageActionButton>
            )}
            {canFork && (
              <MessageActionButton
                label={
                  forking
                    ? t("forkSessionCreating", "Creating new session…")
                    : t("forkSession", "New session — creates an independent copy from here")
                }
                onClick={() => onFork!(entryId!)}
                disabled={forking}
                active={forking}
              >
                {forking ? (
                  <LoaderCircle size={15} className="execution-spinner" aria-hidden="true" />
                ) : (
                  <GitFork size={15} strokeWidth={1.6} aria-hidden="true" />
                )}
              </MessageActionButton>
            )}
          </div>
        )}
        {time && <time className="dsh-message-clock">{time}</time>}
      </div>
    </div>
  );
}

function SkillInvocationView({
  invocation,
  cwd,
  onOpenFile,
  followedByContent,
}: {
  invocation: SkillInvocation;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  followedByContent: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const toggleTitle = expanded
    ? t("collapseSkillInvocation", "Hide skill instructions")
    : t("expandSkillInvocation", "Show skill instructions");

  return (
    <div
      className="dsh-skill-invocation"
      data-testid="skill-invocation"
      data-skill-name={invocation.name}
      data-followed-by-content={followedByContent || undefined}
    >
      <button
        type="button"
        className="dsh-skill-toggle"
        aria-expanded={expanded}
        title={toggleTitle}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown
          className="dsh-skill-chevron"
          size={12}
          strokeWidth={1.6}
          aria-hidden="true"
          data-expanded={expanded || undefined}
        />
        <Box className="dsh-skill-icon" size={13} aria-hidden="true" />
        <span className="dsh-skill-kind">{t("skillInvocation", "skill")}</span>
        <span className="dsh-skill-name">{invocation.name}</span>
      </button>

      {expanded && (
        <div className="dsh-skill-body">
          <MarkdownBody className="markdown-skill-invocation" cwd={cwd} onOpenFile={onOpenFile}>
            {invocation.content}
          </MarkdownBody>
        </div>
      )}
    </div>
  );
}

/** Local expansion state for one row, persisted through the session store. */
function useStoredDisclosure(
  store: ThinkingExpansionStore | undefined,
  stateKey: string,
): { expanded: boolean; toggle: () => void } {
  const localStoreRef = useMemo(() => new ThinkingExpansionStore(1), []);
  const stateStore = store ?? localStoreRef;
  const getSnapshot = useMemo(
    () => () => (stateStore.has(stateKey) ? stateStore.getSnapshot(stateKey) : false),
    [stateKey, stateStore],
  );
  const expanded = useSyncExternalStore(stateStore.subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({ expanded, toggle: () => stateStore.set(stateKey, !expanded) }),
    [expanded, stateKey, stateStore],
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  runningToolCallIds,
  cwd,
  home,
  onOpenFile,
  showTimestamp,
  onLoadDeferredContent,
  entryId,
  thinkingExpansionStore,
  workStepDisplay,
  hideCopy,
  footer,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  runningToolCallIds?: ReadonlySet<string>;
  cwd?: string;
  home?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  entryId?: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
  workStepDisplay?: WorkStepDisplay;
  hideCopy?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const policy = workStepDisplayPolicy(workStepDisplay);
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }) && !isEmptyTextBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const { copied, copy } = useCopyFeedback();

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => void copy(textContent);
  const lastIndex = blockItems.at(-1)?.originalIndex;

  if (!hasRenderableAssistantMessage(message, { isStreaming }) && !isStreaming) return null;

  return (
    <div className="chat-message chat-message-assistant">
      <div className="dsh-assistant">
        <div className="dsh-flow dsh-assistant-body">
          {blockItems.map(({ block, originalIndex }) => (
            <BlockView
              key={originalIndex}
              block={block}
              toolResults={toolResults}
              isStreaming={isStreaming && originalIndex === lastIndex}
              runningToolCallIds={runningToolCallIds}
              cwd={cwd}
              home={home}
              onOpenFile={onOpenFile}
              onLoadDeferredContent={onLoadDeferredContent}
              stateKeyPrefix={entryId ?? "assistant"}
              blockIndex={originalIndex}
              thinkingExpansionStore={thinkingExpansionStore}
              settledReasoningPreview={policy.settledReasoningPreview}
              t={t}
            />
          ))}
          <DeferredContentActions
            content={message.content.filter((block) => block.type !== "image")}
            onLoad={onLoadDeferredContent}
          />
          <AssistantOutcome message={message} isStreaming={isStreaming} />
          {footer}
        </div>

        {!hideCopy && (
          <div className="dsh-assistant-actions">
            {textContent && (
              <MessageActionButton
                className="dsh-message-action-copy"
                label={copied ? t("copyMessageCopied", "Copied") : t("copyMessage", "Copy message")}
                onClick={copyContent}
                active={copied}
              >
                {copied ? (
                  <Check size={15} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <Copy size={15} strokeWidth={1.6} aria-hidden="true" />
                )}
              </MessageActionButton>
            )}
            {time && !isStreaming && <time className="dsh-message-clock">{time}</time>}
          </div>
        )}
      </div>
    </div>
  );
}

function BlockView({
  block,
  toolResults,
  isStreaming,
  runningToolCallIds,
  cwd,
  home,
  onOpenFile,
  onLoadDeferredContent,
  stateKeyPrefix,
  blockIndex,
  thinkingExpansionStore,
  settledReasoningPreview,
  t,
}: {
  block: AssistantContentBlock;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  isStreaming?: boolean;
  runningToolCallIds?: ReadonlySet<string>;
  cwd?: string;
  home?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  stateKeyPrefix: string;
  blockIndex: number;
  thinkingExpansionStore?: ThinkingExpansionStore;
  settledReasoningPreview: boolean;
  t: (key: string, fallback: string) => string;
}) {
  if (block.type === "text") {
    return (
      <div className="dsh-assistant-prose" data-flow-part="response">
        <MarkdownBody isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>
          {(block as TextContent).text}
        </MarkdownBody>
      </div>
    );
  }
  if (block.type === "image") {
    return (
      <div className="dsh-assistant-image" data-flow-part="response">
        <ReplyImage image={block} onLoad={onLoadDeferredContent} />
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <ThinkingBlock
        block={block as ThinkingContent}
        stateKey={`${stateKeyPrefix}:${blockIndex}`}
        store={thinkingExpansionStore}
        isStreaming={isStreaming}
        settledPreview={settledReasoningPreview}
        t={t}
      />
    );
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    return (
      <ToolBlock
        block={tc}
        result={result}
        running={runningToolCallIds?.has(tc.toolCallId)}
        stateKey={`${stateKeyPrefix}:tool:${tc.toolCallId}`}
        store={thinkingExpansionStore}
        cwd={cwd}
        home={home}
        t={t}
      />
    );
  }
  return null;
}

function ThinkingBlock({
  block,
  stateKey,
  store,
  isStreaming,
  settledPreview,
  t,
}: {
  block: ThinkingContent;
  stateKey: string;
  store?: ThinkingExpansionStore;
  isStreaming?: boolean;
  settledPreview: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const { expanded, toggle } = useStoredDisclosure(store, stateKey);
  return (
    <ReasoningRow
      text={block.thinking}
      running={isStreaming === true}
      expanded={expanded}
      onToggle={toggle}
      settledPreview={settledPreview}
      title={t("thinkRowTitle", "Think")}
      runningLabel={t("rowRunning", "Running")}
    />
  );
}

function ToolBlock({
  block,
  result,
  running,
  stateKey,
  store,
  cwd,
  home,
  t,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  running?: boolean;
  stateKey: string;
  store?: ThinkingExpansionStore;
  cwd?: string;
  home?: string;
  t: (key: string, fallback: string) => string;
}) {
  const { expanded, toggle } = useStoredDisclosure(store, stateKey);
  const resultText = getToolResultDisplayText(block.toolName, result, t);
  // The projection replaces a persisted payload the session never stored; that
  // notice is a data-safety fact, so it takes the row's summary slot.
  const rawResultText =
    result === undefined
      ? null
      : result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
  const historyNotice = resultText !== null && rawResultText !== null && resultText !== rawResultText;
  const browserTabId = isBrowserToolName(block.toolName) ? browserTabIdFromResult(resultText) : null;
  const browserSummary =
    isBrowserToolName(block.toolName) && resultText && !result?.isError ? browserResultSummary(resultText, t) : null;
  return (
    <ToolCallRow
      block={block}
      result={result}
      resultText={resultText}
      running={running !== false}
      expanded={expanded}
      onToggle={toggle}
      cwd={cwd}
      home={home}
      t={t}
      runningLabel={t("rowRunning", "Running")}
      preparingLabel={t("rowPreparing", "Preparing tool call")}
      inputLabel={t("toolRowInput", "IN")}
      outputLabel={t("toolRowOutput", "OUT")}
      stoppedLabel={t("rowStopped", "Stopped")}
      missingResultLabel={t("executionResultMissing", "Result was not recorded in the conversation.")}
      browserTabId={browserTabId}
      browserSummary={browserSummary}
      historyNotice={historyNotice}
      onOpenBrowserTab={(tabId) =>
        window.dispatchEvent(new CustomEvent("pi-desktop:open-browser-tab", { detail: { tabId } }))
      }
    />
  );
}

function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useI18n();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const [expanded, setExpanded] = useState(false);
  const firstLine = parsedSummary.body.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";

  return (
    <div className="chat-message chat-message-system">
      <div className="dsh-compaction-row" data-expanded={expanded || undefined}>
        <button
          type="button"
          className="dsh-compaction-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          title={
            expanded
              ? t("collapseCompactionSummary", "Collapse compaction summary")
              : t("expandCompactionSummary", "View compaction summary")
          }
        >
          <span className="dsh-compaction-leading" aria-hidden="true">
            <History className="dsh-compaction-context-icon" size={14} strokeWidth={1.6} />
            <ChevronDown className="dsh-compaction-disclosure-icon" size={14} strokeWidth={1.6} />
          </span>
          <span className="dsh-compaction-title">{t("compactionLabel", "Context compacted")}</span>
          <span className="dsh-compaction-separator" aria-hidden="true" />
          <span className="dsh-compaction-summary">{firstLine}</span>
        </button>
        {expanded && (
          <div className="dsh-compaction-body">
            {parsedSummary.body ? (
              <MarkdownBody variant="compact" className="markdown-compaction-message">
                {parsedSummary.body}
              </MarkdownBody>
            ) : (
              <span className="dsh-compaction-empty">
                {t("compactionUnavailable", "Compaction summary unavailable")}
              </span>
            )}
            <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts: string[] = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} ${t("compactionRead", "read")}`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} ${t("compactionModified", "modified")}`);

  return (
    <details className="dsh-compaction-files">
      <summary>
        {t("compactionFileContext", "File context")}: {parts.join(", ")}
      </summary>
      {modifiedFiles.length > 0 && (
        <CompactionFileList title={t("compactionModifiedFiles", "Modified files")} files={modifiedFiles} />
      )}
      {readFiles.length > 0 && <CompactionFileList title={t("compactionReadFiles", "Read files")} files={readFiles} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="dsh-compaction-file-section">
      <div className="dsh-compaction-file-title">{title}</div>
      <ul className="dsh-compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({
  message,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
}: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => void copy(text || detailsText);
  const preview = text ? previewText(text) : t("extensionMessageHidden", "Extension message");

  return (
    <div className="chat-message chat-message-system">
      <div className="dsh-custom-row" data-expanded={contentExpanded || undefined}>
        <button
          type="button"
          className="dsh-custom-button"
          aria-expanded={contentExpanded}
          onClick={() => setContentExpanded((value) => !value)}
        >
          <span className="dsh-custom-kind">{title}</span>
          <span className="dsh-compaction-separator" aria-hidden="true" />
          <span className="dsh-custom-summary">{preview}</span>
          <ChevronDown className="dsh-custom-chevron" size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>

        {contentExpanded && (
          <div className="dsh-custom-body">
            {isHiddenDisplay && (
              <div className="dsh-custom-note">{t("extensionMessageHiddenLabel", "Hidden extension message")}</div>
            )}
            {images.length > 0 && (
              <div className="dsh-user-attachments">
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return <img key={i} className="dsh-user-image" src={src} alt="" />;
                })}
              </div>
            )}
            {text ? (
              <MarkdownBody variant="compact" className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>
                {text}
              </MarkdownBody>
            ) : (
              <span className="dsh-compaction-empty">{t("extensionMessageEmpty", "(no message)")}</span>
            )}
            <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
          </div>
        )}

        <div className="dsh-custom-footer">
          {text || detailsText ? (
            <button type="button" className="dsh-custom-action" data-active={copied || undefined} onClick={copyContent}>
              {copied ? t("copyMessageCopied", "Copied") : t("copyMessage", "Copy message")}
            </button>
          ) : null}
          {hasDetails && (
            <button type="button" className="dsh-custom-action" onClick={() => setDetailsExpanded((value) => !value)}>
              {detailsExpanded ? t("hideDetails", "Hide details") : t("showDetails", "Show details")}
            </button>
          )}
          {time && <time className="dsh-message-clock">{time}</time>}
        </div>

        {hasDetails && detailsExpanded && <pre className="dsh-custom-details">{detailsText}</pre>}
      </div>
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image" && !b.deferredContent);
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : (img.source.url ?? "");
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}
