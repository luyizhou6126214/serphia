import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readBranchTodoState, SESSION_TODO_TOOL, type SessionTodoState } from "../shared/session-todo";

export function createSessionTodoExtension(): InlineExtension {
  return {
    name: "pi-desktop-todo",
    hidden: true,
    factory(pi) {
      pi.registerTool({
        name: SESSION_TODO_TOOL,
        label: "Todo",
        description:
          "Track tasks on the current conversation branch. Use list to read the checklist, add with text, toggle with an item id, and clear to remove all items.",
        promptGuidelines: [
          "For multi-step work, use todo to track concrete tasks when it helps the user follow progress. Check the existing list before changing it and toggle items as they are completed.",
        ],
        parameters: Type.Object({
          action: Type.Enum(["list", "add", "toggle", "clear"], { type: "string" }),
          text: Type.Optional(Type.String({ description: "Task text for add" })),
          id: Type.Optional(Type.Integer({ minimum: 1, description: "Task ID for toggle" })),
        }),
        // Nested results are not recorded as transcript messages. Sequential calls
        // see the previous result after Pi appends it to the branch.
        exposure: "model-only",
        executionMode: "sequential",
        async execute(_id, params, _signal, _onUpdate, ctx) {
          const state = readBranchTodoState(ctx.sessionManager.getBranch()) ?? { todos: [], nextId: 1 };
          const result = (text: string, next: SessionTodoState = state) => ({
            content: [{ type: "text" as const, text }],
            details: { action: params.action, ...next },
          });

          switch (params.action) {
            case "list":
              return result(
                state.todos.map(({ id, text, done }) => `[${done ? "x" : " "}] #${id}: ${text}`).join("\n") ||
                  "No todos",
              );
            case "add": {
              const text = params.text?.trim();
              if (!text) throw new Error("Todo text is required for add");
              const id = state.nextId;
              return result(`Added todo #${id}: ${text}`, {
                todos: [...state.todos, { id, text, done: false }],
                nextId: id + 1,
              });
            }
            case "toggle": {
              if (params.id === undefined) throw new Error("Todo ID is required for toggle");
              const item = state.todos.find(({ id }) => id === params.id);
              if (!item) throw new Error(`Todo #${params.id} not found`);
              const updated = { ...item, done: !item.done };
              return result(`Todo #${item.id} ${updated.done ? "completed" : "reopened"}`, {
                todos: state.todos.map((todo) => (todo === item ? updated : todo)),
                nextId: state.nextId,
              });
            }
            case "clear":
              return result(`Cleared ${state.todos.length} todos`, { todos: [], nextId: 1 });
          }
        },
      });
    },
  };
}
