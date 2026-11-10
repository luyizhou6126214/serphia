import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { localFileReferenceToMarkdown } from "@/lib/file-url";
import { usePendingComposerMessages, type PendingComposerMessage } from "./usePendingComposerMessages";
import type { useComposerDraft } from "./useComposerDraft";
import type { ComposerActions } from "./useComposerSubmission";

export function usePendingComposerFlow({
  draftKey,
  draft,
  clearInput,
  isStreaming,
  onSend,
  onSteer,
  onFollowUp,
  onPromptWithStreamingBehavior,
}: ComposerActions & {
  draftKey?: string;
  draft: ReturnType<typeof useComposerDraft>;
  clearInput: () => void;
  isStreaming: boolean;
}) {
  const { t } = useI18n();
  const { value, attachedFiles, attachedImages, setSubmissionNotice } = draft;
  const pending = usePendingComposerMessages(draftKey);
  const [pendingSending, setPendingSending] = useState<string | null>(null);
  const pendingInFlight = useRef(new Set<string>());
  const streamingRef = useRef(isStreaming);
  streamingRef.current = isStreaming;
  const stageMessage = useCallback(async () => {
    if (!value.trim() && !attachedFiles.length && !attachedImages.length) return;
    if (attachedImages.length) {
      setSubmissionNotice(
        t("queuedImagesUnsupported", "Image messages can be sent after the current response finishes."),
      );
      return;
    }
    const owner = pending.owner;
    const revision = draft.getRevision();
    try {
      if (!(await draft.validateLocalFileReferences(attachedFiles))) return;
    } catch {
      if (pending.ownerRef.current === owner)
        setSubmissionNotice(t("localFileValidationFailed", "Local file references could not be validated."));
      return;
    }
    if (pending.ownerRef.current !== owner || revision !== draft.getRevision() || !streamingRef.current) return;
    const message: PendingComposerMessage = {
      id: crypto.randomUUID(),
      text: value.trim(),
      files: attachedFiles.map((file) => ({ ...file })),
    };
    const persisted = pending.update(owner, (messages) => [...messages, message]);
    setSubmissionNotice(
      persisted ? null : t("pendingPersistenceFailed", "The pending message is only saved until this app closes."),
    );
    clearInput();
  }, [attachedFiles, attachedImages, clearInput, draft, pending, setSubmissionNotice, t, value]);

  const submitPending = useCallback(
    async (message: PendingComposerMessage, mode: "steer" | "followup" | "send") => {
      const owner = pending.owner;
      const key = `${owner}:${message.id}`;
      if (pendingInFlight.current.has(key)) return;
      pendingInFlight.current.add(key);
      setPendingSending(key);
      try {
        if (!(await draft.validateLocalFileReferences(message.files))) return;
        if (pending.ownerRef.current !== owner) return;
        if (mode !== "send" && !streamingRef.current) return;
        if (mode === "send" && streamingRef.current) return;
        const text = [message.text, ...message.files.map(localFileReferenceToMarkdown)].filter(Boolean).join(" ");
        if (mode === "send") {
          const result = await onSend(text);
          if (result && typeof result === "object" && result.ok === false) throw new Error("Message was not sent");
        } else if (text.startsWith("/") && onPromptWithStreamingBehavior) {
          await onPromptWithStreamingBehavior(text, mode === "steer" ? "steer" : "followUp");
        } else if (mode === "steer" && onSteer) await onSteer(text);
        else if (mode === "followup" && onFollowUp) await onFollowUp(text);
        else return;
        pending.update(owner, (messages) => messages.filter((item) => item.id !== message.id));
      } catch {
        if (pending.ownerRef.current === owner)
          setSubmissionNotice(t("pendingMessageFailed", "Message could not be sent. It is still waiting above."));
      } finally {
        pendingInFlight.current.delete(key);
        setPendingSending((current) => (current === key ? null : current));
      }
    },
    [draft, onFollowUp, onPromptWithStreamingBehavior, onSend, onSteer, pending, setSubmissionNotice, t],
  );

  return { pending, pendingSending, stageMessage, submitPending };
}
