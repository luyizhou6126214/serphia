import { useId } from "react";
import { ChevronDown, Circle, CircleCheck, ListTodo } from "lucide-react";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { SessionTodo } from "@shared/session-todo";

export function SessionTodoPanel({
  todos,
  expanded,
  onToggle,
}: {
  todos: SessionTodo[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { language, t } = useI18n();
  const listId = useId();
  const title = t("sessionTodoTitle", "To-do list");
  const completed = todos.filter(({ done }) => done).length;
  const progress = t("sessionTodoProgress", "{completed}/{total} complete")
    .replace("{completed}", formatNumber(completed, language))
    .replace("{total}", formatNumber(todos.length, language));
  const doneLabel = t("sessionTodoCompleted", "Completed");
  const pendingLabel = t("sessionTodoPending", "Pending");

  return (
    <section
      aria-label={title}
      className="mb-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-subtle)] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <ListTodo size={16} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
        <span className="flex-1 text-xs font-semibold">{title}</span>
        {todos.length > 0 && (
          <span role="status" className="text-[11px] text-[var(--text-muted)] tabular-nums">
            {progress}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={expanded ? "rotate-180 text-[var(--text-muted)]" : "text-[var(--text-muted)]"}
        />
      </button>
      <div
        id={listId}
        hidden={!expanded}
        className="max-h-[min(28dvh,14rem)] overflow-y-auto overscroll-contain border-t border-[var(--border)] px-3"
      >
        {todos.length === 0 ? (
          <p className="my-2.5 text-xs text-[var(--text-muted)]">{t("sessionTodoEmpty", "No tasks on this branch.")}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-[var(--border)] p-0">
            {todos.map(({ id, text, done }) => {
              const Icon = done ? CircleCheck : Circle;
              return (
                <li key={id} className="flex items-start gap-2 py-2 text-xs leading-4">
                  <Icon
                    size={14}
                    aria-hidden="true"
                    className={done ? "shrink-0 text-[var(--success)]" : "shrink-0 text-[var(--text-muted)]"}
                  />
                  <span className="sr-only">{done ? doneLabel : pendingLabel}</span>
                  <span className="shrink-0 text-[var(--text-muted)] tabular-nums">#{formatNumber(id, language)}</span>
                  <span
                    className={
                      done ? "min-w-0 break-words text-[var(--text-muted)] line-through" : "min-w-0 break-words"
                    }
                  >
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
