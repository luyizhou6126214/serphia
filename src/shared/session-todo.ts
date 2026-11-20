export const SESSION_TODO_TOOL = "todo";

export interface SessionTodo {
  id: number;
  text: string;
  done: boolean;
}

export interface SessionTodoState {
  todos: SessionTodo[];
  nextId: number;
}

type Message = {
  role: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
};

/** Pi's example stores a complete snapshot in each successful todo result. */
export function readTodoResult(message: Message): SessionTodoState | undefined {
  if (message.role !== "toolResult" || message.toolName !== SESSION_TODO_TOOL || message.isError) return;
  const details = message.details as Partial<SessionTodoState> | undefined;
  if (!details || !Array.isArray(details.todos) || typeof details.nextId !== "number") return;
  const { todos, nextId } = details;
  if (!Number.isSafeInteger(nextId) || nextId < 1) return;
  if (
    !todos.every(
      (item) =>
        item &&
        Number.isSafeInteger(item.id) &&
        item.id > 0 &&
        item.id < nextId &&
        typeof item.text === "string" &&
        typeof item.done === "boolean",
    )
  )
    return;
  return { todos, nextId };
}

export function readBranchTodoState(
  branch: readonly { type: string; message?: Message }[],
): SessionTodoState | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const { type, message } = branch[index];
    if (type !== "message" || !message) continue;
    const state = readTodoResult(message);
    if (state) return state;
  }
}
