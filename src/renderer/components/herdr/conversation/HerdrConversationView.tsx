import { Fragment, useMemo, useState } from "react";
import type { HerdrConversationMessage } from "@contract/herdr";
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { workStepDisplayPolicy, type WorkStepDisplay } from "@shared/work-step-display";
import { summarizeActivity } from "@/components/chat/process-activity";
import { RunningStatus } from "./RunningStatus";
import { useI18n } from "@/i18n";
import { HerdrMessage } from "./HerdrMessage";
import { HerdrProcessGroup } from "./HerdrProcessGroup";

function messageFor(row: HerdrConversationMessage, index: number, name: string): AgentMessage {
  const { text, timestamp } = row;
  if (row.role === "user") return { role: "user", content: text, timestamp };
  if (row.role === "toolResult")
    return {
      role: "toolResult",
      toolCallId: row.toolCallId ?? "",
      content: [{ type: "text", text }],
      isError: row.isError,
      timestamp,
    };
  const message: AssistantMessage = { role: "assistant", model: name, provider: "herdr", timestamp, content: [] };
  switch (row.role) {
    case "tool":
      message.content.push({
        type: "toolCall",
        toolCallId: row.toolCallId ?? `tool-${index}`,
        toolName: text,
        input: {},
      });
      break;
    case "thinking":
      message.content.push({ type: "thinking", thinking: text });
      break;
    case "error":
      message.stopReason = "error";
      message.errorMessage = text;
      break;
    default:
      message.content.push({ type: "text", text });
  }
  return message;
}

export function HerdrConversationView({
  rows,
  name,
  working,
  cwd,
  pending,
  workStepDisplay,
}: {
  rows: HerdrConversationMessage[];
  name: string;
  working: boolean;
  cwd?: string;
  pending?: string;
  workStepDisplay?: WorkStepDisplay;
}) {
  const { t } = useI18n();
  const [store] = useState(() => new ThinkingExpansionStore());
  const { messages, results, turns, runningIds } = useMemo(() => {
    const messages = rows.map((row, i) => messageFor(row, i, name));
    const results = new Map<string, ToolResultMessage>();
    const turns: number[][] = [];
    for (const [index, message] of messages.entries()) {
      if (message.role === "toolResult") {
        results.set(message.toolCallId, message);
        continue;
      }
      if (!turns.length || message.role === "user") turns.push([]);
      turns[turns.length - 1].push(index);
    }
    const runningIds = new Set<string>();
    if (working) {
      for (const index of turns.at(-1) ?? []) {
        const message = messages[index];
        if (message.role !== "assistant") continue;
        for (const block of message.content) {
          if (block.type === "toolCall" && !results.has(block.toolCallId)) runningIds.add(block.toolCallId);
        }
      }
    }
    return { messages, results, turns, runningIds };
  }, [rows, name, working]);
  function render(index: number, streaming = false) {
    const row = rows[index];
    const id = String(row.timestamp ?? index) + "-" + index;
    return (
      <div className="hd-turn" key={id}>
        {row.source === "pane" && <small className="hd-origin">{t("hdAgentOutput", "Agent output")}</small>}
        <HerdrMessage
          message={messages[index]}
          cwd={cwd}
          toolResults={results}
          runningToolCallIds={runningIds}
          isStreaming={streaming}
          showTimestamp
          entryId={id}
          thinkingExpansionStore={store}
          workStepDisplay={workStepDisplay}
        />
      </div>
    );
  }
  return (
    <>
      {turns.map((indices, n) => {
        const first = indices[0];
        const user = rows[first].role === "user" ? first : undefined;
        const replies = indices.filter((i) => i !== user);
        const answer = replies.findLast((i) => rows[i].role === "assistant" || rows[i].role === "error");
        const steps = replies.filter((i) => i !== answer && (answer === undefined || i < answer));
        const tail = answer === undefined ? [] : replies.filter((i) => i > answer);
        const live = working && n === turns.length - 1 && !pending;
        const id = "turn-" + (rows[first].timestamp ?? first) + "-" + first;
        return (
          <Fragment key={id}>
            {user !== undefined && render(user)}
            {steps.length > 0 && (
              <HerdrProcessGroup
                stateKey={id}
                expansionStore={store}
                policy={workStepDisplayPolicy(workStepDisplay)}
                summary={summarizeActivity(steps.map((i) => messages[i]))}
                startedAt={rows[first].timestamp}
                endedAt={answer === undefined ? undefined : rows[answer].timestamp}
                status={
                  live ? "running" : answer !== undefined && rows[answer].role === "error" ? "failed" : "completed"
                }
              >
                {steps.map((i) => render(i))}
              </HerdrProcessGroup>
            )}
            {answer !== undefined && render(answer, live)}
            {tail.map((i) => render(i))}
          </Fragment>
        );
      })}
      {pending && <HerdrMessage message={{ role: "user", content: pending }} />}
      {working && <RunningStatus startTime={rows.findLast((row) => row.role === "user")?.timestamp} />}
    </>
  );
}
