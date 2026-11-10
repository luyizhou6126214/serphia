import {
  ArrowUp,
  Blocks,
  Copy,
  FileText,
  Minimize2,
  Pencil,
  Puzzle,
  RefreshCw,
  ScrollText,
  Server,
  Terminal,
} from "lucide-react";
import { ComposerToolbar, type ComposerToolbarOptions } from "./composer/ComposerToolbar";
import { ComposerFocusSurface } from "./composer/ComposerFocusSurface";
import { ComposerStats } from "./composer/ComposerStats";
import { ReferenceText, referenceCursorDestination, referenceDeletionRange } from "./composer/ReferenceText";
import { useComposerDraft } from "@/hooks/useComposerDraft";
import { useComposerSubmission, type ComposerActions } from "@/hooks/useComposerSubmission";
import { usePendingComposerFlow } from "@/hooks/usePendingComposerFlow";
import { PendingMessages } from "./composer/PendingMessages";
import { QueuedMessageRow } from "./composer/QueuedMessageRow";
import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_SOURCES,
  SLASH_SOURCE_GROUP_LABEL,
  SLASH_SOURCE_ORDER,
  SLASH_COMMAND_COLLATOR,
  slashMatchRank,
  type SlashCommandSource,
  type SlashCommandPaletteItem,
} from "./composer/slash-commands";
import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  KeyboardEvent,
} from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { CHAT_COLUMN_PADDING, CHAT_INPUT_RIGHT_PADDING } from "@/lib/chat-layout";
import type { CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import { buildAtInsertText, extractAtQuery, type AtQueryMatch, type FileIndexEntry } from "@/lib/file-fuzzy";
import { useFileSuggestions } from "@/hooks/useFileSuggestions";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { localFilePathKey } from "@/lib/file-url";
import type { ContextUsage, SessionStatsInfo } from "@shared/pi-types";

export type { AttachedImage } from "@/hooks/useComposerDraft";

interface Props extends ComposerActions, ComposerToolbarOptions {
  isCompacting?: boolean;
  compactResult?: CompactResultInfo | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  draftKey?: string;
  /** Explicit temporary owner to carry forward when this view receives its real session ID. */
  draftPromotionFrom?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  welcome?: boolean;
  sessionStats?: SessionStatsInfo | null;
  contextUsage?: ContextUsage | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  prependText: (text: string) => void;
  addFiles: (files: File[]) => void;
}

const COMPOSITION_END_ENTER_GRACE_MS = 100;

function resizeComposer(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  const height = ta.scrollHeight;
  ta.style.height = `${Math.min(height, 200)}px`;
  ta.style.overflowY = height > 200 ? "auto" : "hidden";
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

const ChatInputComponent = forwardRef<ChatInputHandle, Props>(function ChatInput(
  {
    onSend,
    onSteer,
    onFollowUp,
    isStreaming,
    isCompacting,
    compactResult,
    retryInfo,
    queuedMessages,
    onRecallQueue,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    onBuiltinCommand,
    onPromptWithStreamingBehavior,
    draftKey,
    draftPromotionFrom,
    cwd,
    welcome = false,
    sessionStats,
    contextUsage,
    ...toolbarOptions
  }: Props,
  ref,
) {
  const isMobile = useIsMobile();
  const { t, language } = useI18n();
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashCursor, setSlashCursor] = useState<number | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState(320);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceMirrorRef = useRef<HTMLDivElement>(null);
  const slashAnchorRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const atMenuRef = useRef<HTMLDivElement>(null);
  const atScrollRef = useRef<HTMLDivElement>(null);
  const atDismissedRef = useRef(false);
  const atKeyboardNavigationRef = useRef(false);
  const slashScrollRef = useRef<HTMLDivElement>(null);
  const slashDismissedRef = useRef(false);
  const slashKeyboardNavigationRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openAttachmentPicker = useCallback(() => fileInputRef.current?.click(), []);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resetAtQuery = useCallback(() => setAtQuery(null), []);
  const draft = useComposerDraft({ draftKey, draftPromotionFrom, cwd, onReplace: resetAtQuery });
  const {
    value,
    setValue,
    attachedImages,
    attachedFiles,
    fileInspectionByPath,
    imageAttachNotice,
    setImageAttachNotice,
    submissionNotice,
    setSubmissionNotice,
    processFiles,
    removeImage,
    removeFile,
    clearDraft,
  } = draft;
  const clearInput = useCallback(() => {
    clearDraft();
    setAtQuery(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [clearDraft]);

  const { pending, pendingSending, stageMessage, submitPending } = usePendingComposerFlow({
    draftKey,
    draft,
    clearInput,
    isStreaming,
    onSend,
    onSteer,
    onFollowUp,
    onPromptWithStreamingBehavior,
  });
  const { handleSend } = useComposerSubmission({
    draft,
    clearInput,
    isStreaming,
    onSend,
    onSteer,
    onFollowUp,
    onPromptWithStreamingBehavior,
    onBuiltinCommand,
  });

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        setSlashCursor(text.length);
        resizeComposer(ta);
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        setSlashCursor(combined.length);
        resizeComposer(ta);
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        setSlashCursor(pos);
        ta.focus();
        resizeComposer(ta);
      });
    },
    addFiles(files: File[]) {
      void processFiles(files);
    },
  }));

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (value) resizeComposer(ta);
    else {
      ta.style.height = "auto";
      ta.style.overflowY = "hidden";
    }
  }, [value]);

  const slashPrefix = value.slice(0, slashCursor ?? value.length);
  const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(slashPrefix);
  const slashStart = slashMatch ? slashPrefix.length - slashMatch[1].length - 1 : null;
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        if (slashStart !== 0 && command.source !== "skill") return false;
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
        if (rankDelta !== 0) return rankDelta;
        return (
          SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source] || SLASH_COMMAND_COLLATOR.compare(a.name, b.name)
        );
      });
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<
      SlashCommandSource,
      { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }
    >();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES.map((source) => groups.get(source)!).filter((group) => group.items.length > 0);
  })();

  const updateAtQuery = useCallback(
    (text: string, cursor: number | null) => {
      if (!cwd) {
        setAtQuery(null);
        return;
      }
      const pos = cursor ?? text.length;
      setAtQuery(extractAtQuery(text.slice(0, pos)));
    },
    [cwd],
  );

  const { tokenKey: atTokenKey, state: activeSuggestionState, matches: atMatches } = useFileSuggestions(cwd, atQuery);

  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      atDismissedRef.current = false;
      return;
    }
    if (atDismissedRef.current) return;
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  const applyAtCompletion = useCallback(
    (entry: FileIndexEntry) => {
      if (!atQuery) return;
      const ta = textareaRef.current;
      const cursor = ta?.selectionStart ?? value.length;
      const before = value.slice(0, atQuery.start);
      let after = value.slice(cursor);
      // Completing inside a quoted token (@"my dir/… with the caret before the
      // closing quote): the replacement carries its own closing quote, so drop
      // the old one right after the caret (mirrors the TUI's applyCompletion).
      if (atQuery.quoted && after.startsWith('"')) {
        after = after.slice(1);
      }
      const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
      const newValue = before + insert.text + after;
      const newPos = before.length + insert.cursorOffset;
      setValue(newValue);
      setSlashCursor(newPos);
      // setValue alone does not fire onChange — re-derive the token here. Files
      // end with a space (token closes, menu hides); directories end with "/"
      // before the caret (token stays open for drill-down into the directory).
      setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(newPos, newPos);
        resizeComposer(el);
      });
    },
    [atQuery, setValue, value],
  );

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen || !atKeyboardNavigationRef.current) return;
    atKeyboardNavigationRef.current = false;
    const item = atItemRefs.current[atActiveIndex];
    const container = atScrollRef.current;
    if (!item || !container) return;
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (itemRect.top < containerRect.top) container.scrollTop += itemRect.top - containerRect.top;
    else if (itemRect.bottom > containerRect.bottom) container.scrollTop += itemRect.bottom - containerRect.bottom;
  }, [atActiveIndex, atMenuOpen]);

  const applySlashCommand = useCallback(
    (command: SlashCommandPaletteItem) => {
      const cursor = textareaRef.current?.selectionStart ?? value.length;
      const start = slashStart ?? cursor;
      const afterCursor = value.slice(cursor);
      const suffix = afterCursor.replace(/^[^\s]*/, "");
      const insert = `/${command.name} `;
      const nextValue = value.slice(0, start) + insert + suffix;
      const nextCursor = start + insert.length;
      setValue(nextValue);
      setSlashCursor(nextCursor);
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
        resizeComposer(ta);
      });
    },
    [setValue, slashStart, value],
  );

  const getNextSlashIndex = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const lastIndex = filteredSlashCommands.length - 1;
      if (lastIndex < 0) return 0;

      if (direction === "left") return Math.max(0, slashActiveIndex - 1);
      if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

      const currentNode = slashItemRefs.current[slashActiveIndex];
      if (!currentNode) {
        return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
      }

      const currentRect = currentNode.getBoundingClientRect();
      const currentX = currentRect.left + currentRect.width / 2;
      const currentY = currentRect.top + currentRect.height / 2;
      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let index = 0; index <= lastIndex; index += 1) {
        if (index === slashActiveIndex) continue;
        const node = slashItemRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const candidateY = rect.top + rect.height / 2;
        const verticalDelta = candidateY - currentY;
        if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

        const candidateX = rect.left + rect.width / 2;
        const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
        if (score < bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }

      if (bestIndex >= 0) return bestIndex;
      return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
    },
    [filteredSlashCommands.length, slashActiveIndex],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (!isComposing && (e.key === "Backspace" || e.key === "Delete") && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const ta = e.currentTarget;
        const range = referenceDeletionRange(value, ta.selectionStart, ta.selectionEnd, e.key);
        if (range) {
          e.preventDefault();
          const nextValue = value.slice(0, range.start) + value.slice(range.end);
          setValue(nextValue);
          setSlashCursor(range.start);
          updateAtQuery(nextValue, range.start);
          requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(range.start, range.start);
          });
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          slashKeyboardNavigationRef.current = true;
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slashKeyboardNavigationRef.current = true;
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          slashKeyboardNavigationRef.current = true;
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          slashKeyboardNavigationRef.current = true;
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          slashDismissedRef.current = true;
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          atKeyboardNavigationRef.current = true;
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          atKeyboardNavigationRef.current = true;
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          atDismissedRef.current = true;
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (!isComposing && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const ta = e.currentTarget;
        const direction = e.key === "ArrowLeft" ? "left" : "right";
        const selectionStart = ta.selectionStart;
        const selectionEnd = ta.selectionEnd;
        const hasSelection = selectionStart !== selectionEnd;
        const focus =
          hasSelection && e.shiftKey
            ? ta.selectionDirection === "backward"
              ? selectionStart
              : selectionEnd
            : direction === "left"
              ? selectionStart
              : selectionEnd;
        const destination = referenceCursorDestination(value, focus, direction);
        // Native selection collapse already lands on a boundary; only intervene
        // when that boundary would put the caret inside a reference.
        const insideSelectionBoundary =
          hasSelection &&
          !e.shiftKey &&
          destination !== null &&
          destination !== focus &&
          destination !== (direction === "left" ? selectionStart : selectionEnd) &&
          referenceCursorDestination(value, focus, direction === "left" ? "right" : "left") !== null;
        if (destination !== null && (!hasSelection || e.shiftKey || insideSelectionBoundary)) {
          e.preventDefault();
          if (e.shiftKey) {
            const anchor = hasSelection
              ? ta.selectionDirection === "backward"
                ? selectionEnd
                : selectionStart
              : focus;
            ta.setSelectionRange(
              Math.min(anchor, destination),
              Math.max(anchor, destination),
              destination < anchor ? "backward" : "forward",
            );
          } else {
            ta.setSelectionRange(destination, destination);
          }
          setSlashCursor(destination);
          updateAtQuery(value, destination);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const blurOnCommit = () => {
          if (textarea && document.activeElement === textarea) textarea.blur();
        };
        if (isStreaming && (onSteer || onFollowUp)) {
          void stageMessage();
        } else {
          void handleSend(blurOnCommit);
        }
      }
    },
    [
      isStreaming,
      onSteer,
      onFollowUp,
      value,
      setValue,
      updateAtQuery,
      slashMenuOpen,
      slashQuery,
      filteredSlashCommands,
      slashActiveIndex,
      applySlashCommand,
      stageMessage,
      handleSend,
      getNextSlashIndex,
      atMenuOpen,
      atQuery,
      atMatches,
      atActiveIndex,
      applyAtCompletion,
    ],
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    resizeComposer(ta);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const fileItems = items.filter((item) => item.kind === "file");
      if (!fileItems.length) return;
      e.preventDefault();
      const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      void processFiles(files);
    },
    [processFiles],
  );

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      slashDismissedRef.current = false;
      return;
    }
    if (slashDismissedRef.current) return;
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useLayoutEffect(() => {
    if (!slashMenuOpen && !atMenuOpen) return;
    const anchor = slashAnchorRef.current;
    const boundary = anchor?.closest(".chat-appearance-scope");
    if (!anchor || !boundary) return;
    const updateHeight = () => {
      const available = anchor.getBoundingClientRect().top - boundary.getBoundingClientRect().top - 16;
      setSlashMenuMaxHeight(Math.max(0, Math.min(320, window.innerHeight * 0.56, available)));
    };
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(anchor);
    observer?.observe(boundary);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [slashMenuOpen, atMenuOpen, welcome]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (slashMenuRef.current?.contains(target) || textareaRef.current?.contains(target))) return;
      slashDismissedRef.current = true;
      setSlashMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!atMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (atMenuRef.current?.contains(target) || textareaRef.current?.contains(target))) return;
      atDismissedRef.current = true;
      setAtMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [atMenuOpen]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen || !slashKeyboardNavigationRef.current) return;
    slashKeyboardNavigationRef.current = false;
    const item = slashItemRefs.current[slashActiveIndex];
    const container = slashScrollRef.current;
    if (!item || !container) return;
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (itemRect.top < containerRect.top) container.scrollTop += itemRect.top - containerRect.top;
    else if (itemRect.bottom > containerRect.bottom) container.scrollTop += itemRect.bottom - containerRect.bottom;
  }, [slashActiveIndex, slashMenuOpen]);

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactVerb =
    compactResult?.reason && compactResult.reason !== "manual"
      ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} compacted`
      : "Compacted";
  const compactResultText = compactResult
    ? `${compactVerb} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${formatTokenCount(compactSavedTokens)} saved)`
    : null;
  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: `12px ${CHAT_COLUMN_PADDING}px`,
        // Keep the composer column on the message column by reserving the same minimap gutter.
        paddingRight: isMobile || welcome ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void processFiles(files);
          e.target.value = "";
        }}
      />
      <div className="chat-content-column">
        <PendingMessages
          pending={pending}
          sending={pendingSending}
          isStreaming={isStreaming}
          canSteer={!!onSteer}
          canFollowUp={!!onFollowUp}
          onSubmit={submitPending}
        />
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) > 0 && (
          <div
            style={{
              marginBottom: 8,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              padding: "5px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 8px 4px 10px",
              }}
            >
              <span
                style={{
                  fontSize: scaledChatFont(10),
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {t("queued", "Queued")} ·{" "}
                {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                  title={t(
                    "recallQueueDescription",
                    "Remove all queued messages and put them back into the input box for editing",
                  )}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: scaledChatFont(12),
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                  {t("recallToInput", "Recall to input")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "rgba(234,179,8,0.08)",
              border: "1px solid rgba(234,179,8,0.25)",
              borderRadius: 6,
              fontSize: scaledChatFont(12),
              color: "rgba(180,130,0,0.9)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            {t("retrying", "Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…
            {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {imageAttachNotice && (
          <div
            role="alert"
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
              borderRadius: 6,
              fontSize: scaledChatFont(12),
              color: "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>{imageAttachNotice}</span>
            <button
              type="button"
              onClick={() => setImageAttachNotice(null)}
              aria-label="Dismiss image attachment error"
              style={{
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                padding: 2,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}
        {submissionNotice && (
          <div
            role="alert"
            data-testid="composer-submission-error"
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
              borderRadius: 6,
              fontSize: scaledChatFont(12),
              color: "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>{submissionNotice}</span>
            <button
              type="button"
              onClick={() => setSubmissionNotice(null)}
              aria-label={t("dismissSubmissionError", "Dismiss submission error")}
              style={{
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                padding: 2,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}
        {compactResultText && (
          <div
            style={{
              marginBottom: 8,
              padding: "5px 10px",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.24)",
              borderRadius: 6,
              fontSize: scaledChatFont(12),
              color: "rgba(5,150,105,0.95)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {compactResultText}
          </div>
        )}
        <ComposerFocusSurface cardRef={slashAnchorRef} streaming={isStreaming}>
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                boxShadow: "0 -6px 20px rgba(0,0,0,0.08)",
                overflow: "hidden",
                maxHeight: slashMenuMaxHeight,
              }}
            >
              <div
                ref={slashScrollRef}
                className="slash-menu-scroll"
                style={{ maxHeight: slashMenuMaxHeight, overflowY: "auto", padding: "8px" }}
              >
                {slashCommandsLoading && (
                  <div style={{ padding: "6px", fontSize: scaledChatFont(12), color: "var(--text-dim)" }}>
                    {t("loadingCommands", "Loading commands…")}
                  </div>
                )}
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "6px", fontSize: scaledChatFont(12), color: "var(--text-dim)" }}>
                    {t("noSlashCommandsFound", "No extension, prompt, or skill commands found")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 6 }}>
                      {group.source !== "builtin" && group.source !== "extension" && (
                        <div style={{ padding: "6px 6px 4px", color: "var(--text-dim)", fontSize: scaledChatFont(11) }}>
                          {SLASH_SOURCE_GROUP_LABEL[group.source]}
                        </div>
                      )}
                      {group.items.map(({ command, index }) => {
                        const active = index === slashActiveIndex;
                        const builtinIcons: Record<string, typeof Terminal> = {
                          compact: Minimize2,
                          copy: Copy,
                          name: Pencil,
                          reload: RefreshCw,
                          session: ScrollText,
                          mcp: Server,
                        };
                        const Icon =
                          builtinIcons[command.name] ??
                          (command.source === "skill"
                            ? Blocks
                            : command.source === "extension"
                              ? Puzzle
                              : command.source === "prompt"
                                ? FileText
                                : Terminal);
                        const scope = command.source === "skill" ? command.sourceInfo?.scope : undefined;
                        const scopeLabel =
                          scope === "project"
                            ? t("skillScopeProject", "project")
                            : scope === "user"
                              ? t("slashSkillScopeUser", "User (global)")
                              : scope === "temporary"
                                ? t("slashSkillScopeTemporary", "Temporary")
                                : t("slashSkillScopeUnknown", "Unknown scope");
                        return (
                          <button
                            key={`${command.source}:${command.name}`}
                            ref={(node) => {
                              slashItemRefs.current[index] = node;
                            }}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applySlashCommand(command);
                            }}
                            onMouseEnter={() => {
                              slashKeyboardNavigationRef.current = false;
                              setSlashActiveIndex(index);
                            }}
                            title={command.description}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px",
                              border: 0,
                              borderRadius: 6,
                              background: active ? "var(--bg-selected)" : "transparent",
                              color: "var(--text)",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <Icon size={15} style={{ flexShrink: 0, color: "var(--text-dim)" }} />
                            <span
                              style={{
                                flexShrink: 0,
                                maxWidth: "40%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontSize: scaledChatFont(12),
                              }}
                            >
                              {command.source === "skill"
                                ? command.name.replace(/^skill:/, "")
                                : command.name === "mcp"
                                  ? "MCP"
                                  : command.name.charAt(0).toUpperCase() + command.name.slice(1)}
                            </span>
                            {command.description && (
                              <span
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontSize: scaledChatFont(12),
                                  color: "var(--text-dim)",
                                }}
                              >
                                {command.description}
                              </span>
                            )}
                            {command.source === "skill" && (
                              <span
                                style={{
                                  marginLeft: "auto",
                                  flexShrink: 0,
                                  fontSize: scaledChatFont(11),
                                  color: "var(--text-dim)",
                                }}
                              >
                                {scopeLabel}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>
            </div>
          )}

          {atMenuOpen &&
            atQuery !== null &&
            (() => {
              const suggestionStatus = activeSuggestionState?.status ?? "loading";
              const suggestionsLoading = suggestionStatus === "loading";
              const matchCountLabel =
                atMatches.length === 1
                  ? t("oneMatch", "1 match")
                  : t("matchCount", "{count} matches").replace("{count}", String(atMatches.length));
              const resultHint = activeSuggestionState?.degradedReason
                ? ` · ${t("fileSearchDegraded", "limited to this folder")}`
                : activeSuggestionState?.truncated
                  ? ` · ${t("fileIndexTruncated", "index truncated")}`
                  : "";
              return (
                <div
                  ref={atMenuRef}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: "calc(100% + 8px)",
                    zIndex: 120,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    boxShadow: "0 -6px 20px rgba(0,0,0,0.08)",
                    overflow: "hidden",
                    maxHeight: slashMenuMaxHeight,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    aria-live="polite"
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: scaledChatFont(11),
                      color: "var(--text-dim)",
                    }}
                  >
                    <span>
                      {suggestionsLoading
                        ? t("loadingProjectFiles", "Loading files…")
                        : `${t("filesAndMatchCount", "Files · {count}").replace(
                            "{count}",
                            matchCountLabel,
                          )}${resultHint}`}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
                  </div>
                  <div
                    ref={atScrollRef}
                    className="slash-menu-scroll"
                    style={{ minHeight: 0, overflowY: "auto", padding: 8 }}
                  >
                    {atMatches.length === 0 ? (
                      <div style={{ padding: "6px 8px", fontSize: scaledChatFont(12), color: "var(--text-dim)" }}>
                        {suggestionsLoading
                          ? t("searching", "Searching…")
                          : suggestionStatus === "error"
                            ? t("fileSuggestionsUnavailable", "File suggestions are temporarily unavailable")
                            : t("noMatchingProjectFiles", "No matching files")}
                      </div>
                    ) : (
                      atMatches.map((entry, index) => {
                        const active = index === atActiveIndex;
                        const name = entry.path.split("/").pop() ?? entry.path;
                        const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                        return (
                          <button
                            key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                            ref={(node) => {
                              atItemRefs.current[index] = node;
                            }}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyAtCompletion(entry);
                            }}
                            onMouseEnter={() => {
                              atKeyboardNavigationRef.current = false;
                              setAtActiveIndex(index);
                            }}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 8px",
                              border: "none",
                              borderRadius: 6,
                              background: active ? "var(--bg-selected)" : "none",
                              color: "var(--text)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: scaledChatFont(12.5),
                              fontFamily: "inherit",
                            }}
                          >
                            <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                              {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                            </span>
                            <span
                              style={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                              {name}
                              {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          {/* Image previews */}
          {attachedImages.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {attachedImages.map((img, i) => (
                <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                  <img
                    src={img.previewUrl}
                    alt=""
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      display: "block",
                    }}
                  />
                  <button
                    onClick={() => removeImage(i)}
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--text-muted)",
                    }}
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <line x1="1" y1="1" x2="7" y2="7" />
                      <line x1="7" y1="1" x2="1" y2="7" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* File attachment chips */}
          {attachedFiles.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {attachedFiles.map((file, i) => (
                  <div
                    key={`${file.path}-${i}`}
                    title={`${file.path}${
                      fileInspectionByPath.get(localFilePathKey(file.path))?.insideCwd === false
                        ? ` — ${t("outsideProject", "Outside project")}`
                        : ""
                    }`}
                    onClick={() => void window.piBridge?.showItemInFolder?.(file.path)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const request = window.piBridge.showFileContextMenu({
                        href: file.path,
                        cwd: cwd ?? undefined,
                        source: "local-file-reference",
                        language,
                      });
                      void request
                        .then((result) => {
                          if (!result.shown) {
                            setSubmissionNotice(t("fileContextMenuUnavailable", "The file menu could not be opened."));
                          }
                        })
                        .catch(() => {
                          setSubmissionNotice(t("fileContextMenuUnavailable", "The file menu could not be opened."));
                        });
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: 260,
                      padding: "4px 6px 4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${
                        fileInspectionByPath.get(localFilePathKey(file.path))?.exists === false
                          ? "var(--danger)"
                          : "var(--border)"
                      }`,
                      background: "var(--bg-panel)",
                      cursor: "pointer",
                      fontSize: scaledChatFont(12),
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0, color: "var(--text-muted)" }}
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {file.name}
                    </span>
                    {fileInspectionByPath.get(localFilePathKey(file.path))?.insideCwd === false && (
                      <span style={{ color: "var(--warning)", fontSize: scaledChatFont(10), whiteSpace: "nowrap" }}>
                        {t("outsideProject", "Outside project")}
                      </span>
                    )}
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFile(i);
                      }}
                      title={t("remove", "Remove")}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "transparent",
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        padding: 0,
                        color: "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <line x1="1" y1="1" x2="7" y2="7" />
                        <line x1="7" y1="1" x2="1" y2="7" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 4, fontSize: scaledChatFont(10.5), color: "var(--text-dim)" }}>
                {t(
                  "localFileDraftPrivacy",
                  "Local file paths stay on this device and are saved with this session draft until it is sent or removed.",
                )}
              </div>
            </div>
          )}

          {/* Main input */}
          <div style={{ position: "relative" }}>
            <div className="chat-composer-shell">
              <div className="chat-composer-editor">
                <div
                  ref={referenceMirrorRef}
                  className="chat-composer-reference-mirror"
                  aria-hidden="true"
                  style={{ fontSize: scaledChatFont(14) }}
                >
                  <ReferenceText text={value} requireTerminator />
                  {"\n"}
                </div>
                <textarea
                  ref={textareaRef}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setSlashCursor(e.target.selectionStart);
                    updateAtQuery(e.target.value, e.target.selectionStart);
                  }}
                  onSelect={(e) => {
                    const el = e.currentTarget;
                    setSlashCursor(el.selectionStart);
                    updateAtQuery(el.value, el.selectionStart);
                  }}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    isComposingRef.current = false;
                    lastCompositionEndAtRef.current = Date.now();
                    const el = e.currentTarget;
                    setSlashCursor(el.selectionStart);
                    updateAtQuery(el.value, el.selectionStart);
                  }}
                  onInput={handleInput}
                  onScroll={(e) => {
                    if (referenceMirrorRef.current) {
                      referenceMirrorRef.current.scrollTop = e.currentTarget.scrollTop;
                      referenceMirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    isCompacting
                      ? t("compacting", "Compacting…")
                      : isStreaming && (onSteer || onFollowUp)
                        ? t("steerOrQueue", "Type a message, then choose how to send it…")
                        : isStreaming
                          ? t("agentRunning", "Agent is running…")
                          : t("messagePlaceholder", "Message Serphia… Type / for commands, @ for files")
                  }
                  rows={1}
                  spellCheck={false}
                  style={{
                    flex: 1,
                    background: "none",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    color: value ? "transparent" : "var(--text)",
                    caretColor: "var(--text)",
                    fontSize: scaledChatFont(14),
                    lineHeight: 1.6,
                    fontFamily: "inherit",
                    minHeight: 24,
                    maxHeight: 200,
                    overflowX: "hidden",
                    overflowY: "hidden",
                  }}
                />
              </div>
            </div>
          </div>

          <ComposerToolbar
            options={{ ...toolbarOptions, isStreaming }}
            isMobile={isMobile}
            hasAttachments={attachedImages.length > 0 || attachedFiles.length > 0}
            onAttach={openAttachmentPicker}
          />
          {!isStreaming && (
            <button
              type="button"
              className="chat-composer-send"
              onClick={() => void handleSend()}
              disabled={!value.trim() && !attachedImages.length && !attachedFiles.length}
              aria-label={t("send", "Send")}
              title={t("send", "Send")}
            >
              <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </ComposerFocusSurface>
        {!welcome && <ComposerStats sessionStats={sessionStats} contextUsage={contextUsage} />}
      </div>
    </div>
  );
});

export const ChatInput = React.memo(ChatInputComponent);
