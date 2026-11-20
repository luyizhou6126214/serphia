import { useId, useState } from "react";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { SessionTodo } from "@shared/session-todo";

export function SessionTodoPanel({ todos }: { todos: SessionTodo[] }) {
  const { language, t } = useI18n();
  const listId = useId();
  const [expanded, setExpanded] = useState(true);
  const title = t("sessionTodoTitle", "To-do list");
  const completed = todos.filter(({ done }) => done).length;
  const progress = t("sessionTodoProgress", "{completed}/{total} complete")
    .replace("{completed}", formatNumber(completed, language))
    .replace("{total}", formatNumber(todos.length, language));

  return (
    <section aria-label={title} className="session-todo-panel">
      <button
        type="button"
        aria-label={title}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 text-start hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--action-blue)] sm:px-4"
      >
        <ListChecks size={16} aria-hidden="true" className="shrink-0 text-[var(--action-blue)]" />
        <span className="flex-1 text-[13px] font-semibold">{title}</span>
        {todos.length > 0 && (
          <span role="status" className="flex items-center gap-2 text-xs text-[var(--text-muted)] tabular-nums">
            <span
              aria-hidden="true"
              className="hidden h-1 w-10 overflow-hidden rounded-full bg-[var(--border)] sm:block"
            >
              <span
                className="block h-full rounded-full bg-[var(--action-blue)]"
                style={{ width: `${(completed / todos.length) * 100}%` }}
              />
            </span>
            {progress}
          </span>
        )}
        <span className="grid size-7 shrink-0 place-items-center text-[var(--text-muted)]">
          <ChevronDown size={14} aria-hidden="true" className={expanded ? "rotate-180" : undefined} />
        </span>
      </button>
      <div
        id={listId}
        hidden={!expanded}
        className="max-h-[min(22dvh,10rem)] overflow-y-auto overscroll-contain px-3 pb-2 sm:px-4"
      >
        {todos.length === 0 ? (
          <p className="my-1 text-xs text-[var(--text-muted)]">{t("sessionTodoEmpty", "No tasks on this branch.")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {todos.map(({ id, text, done }) => (
              <li key={id} className="flex items-start gap-2 py-1 text-[13px] leading-5">
                <span aria-hidden="true" data-done={done} className="session-todo-mark">
                  {done && <Check size={10} strokeWidth={2.5} />}
                </span>
                <span className="sr-only">
                  {done ? t("sessionTodoCompleted", "Completed") : t("sessionTodoPending", "Pending")}
                </span>
                <span
                  dir="auto"
                  className={done ? "wrap-anywhere text-[var(--text-muted)] line-through" : "wrap-anywhere"}
                >
                  {text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
