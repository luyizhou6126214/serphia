import { useMemo, type ReactNode } from "react";
import { collectTurnChanges } from "@/lib/turn-changes";
import type { AgentMessage } from "@/lib/types";
import { TurnChanges } from "./TurnChanges";

/**
 * The closing card of one assistant turn: the files its tools changed and the
 * diff each change recorded. It reads only its own message slice, so the card
 * belongs to the turn that produced it.
 */
export function TurnChangesTail({
  messages,
  userIdx,
  cwd,
  home,
  onOpenFile,
}: {
  messages: readonly AgentMessage[];
  userIdx: number;
  cwd?: string | undefined;
  home?: string | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
}) {
  const files = useMemo(() => {
    let end = userIdx + 1;
    while (end < messages.length && messages[end]?.role !== "user") end += 1;
    return collectTurnChanges(messages, userIdx, end, { cwd, home });
  }, [messages, userIdx, cwd, home]);
  if (files.length === 0) return null;
  return (
    <div data-flow-part="changes">
      <TurnChanges files={files} onOpenFile={onOpenFile} />
    </div>
  );
}

/**
 * Footer elements for every turn, stable while the transcript itself is.
 * Streaming updates a sibling state, not `messages`; creating the elements once
 * per transcript keeps settled messages memoized through the stream.
 */
export function useTurnChangeFooters(
  messages: readonly AgentMessage[],
  cwd: string | undefined,
  home: string | undefined,
  onOpenFile: ((filePath: string) => void) | undefined,
): Map<number, ReactNode> {
  return useMemo(() => {
    const footers = new Map<number, ReactNode>();
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index]?.role !== "user") continue;
      footers.set(
        index,
        <TurnChangesTail messages={messages} userIdx={index} cwd={cwd} home={home} onOpenFile={onOpenFile} />,
      );
    }
    return footers;
  }, [messages, cwd, home, onOpenFile]);
}
