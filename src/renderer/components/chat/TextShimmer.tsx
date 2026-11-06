/**
 * Text activity animation shared by a process row and its nested text
 * fragments. Ported from DeepSeek Harness's TextShimmer: the real text stays
 * selectable and accessible, and the running highlight is painted by an inert
 * duplicate that rides a moving mask.
 */
import { createContext, memo, useContext, type ReactNode } from "react";
import { cx } from "./cx";

const DecorativeCopy = createContext<boolean | undefined>(undefined);

export interface TextShimmerProps {
  /** Text or presentational children with text in nested TextShimmer instances. */
  children: ReactNode;
  /** Whether to animate; nested instances share the containing row's activity. */
  active?: boolean | undefined;
  className?: string | undefined;
  /** Layout class applied equally to the base and decorative content. */
  contentClassName?: string | undefined;
}

function TextContent({ children, className }: Pick<TextShimmerProps, "children" | "className">) {
  const decorative = useContext(DecorativeCopy);
  // Duplicating a string twice in the accessibility tree would make a screen
  // reader read the row aloud twice; the copy is painted from a pseudo element.
  const generated = decorative === true && typeof children === "string";
  return (
    <span className={cx("dsh-shimmer-text", className)} data-shimmer-text={generated ? children : undefined}>
      {generated ? null : children}
    </span>
  );
}

/**
 * Render text with one shared highlight while retaining selectable, accessible
 * content. Nested instances inherit the outer animation.
 */
export const TextShimmer = memo(function TextShimmer({
  children,
  active = false,
  className,
  contentClassName,
}: TextShimmerProps) {
  const decorative = useContext(DecorativeCopy);
  if (decorative !== undefined) return <TextContent className={className}>{children}</TextContent>;
  const content = typeof children === "string" ? <TextContent>{children}</TextContent> : children;
  return (
    <span className={cx("dsh-shimmer", className)} data-shimmer={active || undefined}>
      <DecorativeCopy.Provider value={false}>
        <span className={cx("dsh-shimmer-content", contentClassName)}>{content}</span>
      </DecorativeCopy.Provider>
      {active && (
        <span className="dsh-shimmer-decoration" aria-hidden="true" inert={true}>
          <span className="dsh-shimmer-sweep">
            <DecorativeCopy.Provider value={true}>
              <span className={cx("dsh-shimmer-content", "dsh-shimmer-highlight", contentClassName)}>{content}</span>
            </DecorativeCopy.Provider>
          </span>
        </span>
      )}
    </span>
  );
});
