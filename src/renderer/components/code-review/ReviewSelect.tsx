import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Props = Omit<ComponentProps<"select">, "onChange" | "aria-label"> & {
  label: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
  caption?: boolean;
};

export function ReviewSelect({ label, onChange, icon, caption, title, className, ...props }: Props) {
  return (
    <span className="cr-field">
      {caption && (
        <span className="cr-field-caption" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="cr-select-wrap" title={title}>
        {icon && (
          <span className="cr-select-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <select
          {...props}
          aria-label={label}
          className={className ? `cr-select ${className}` : "cr-select"}
          onChange={(event) => onChange(event.target.value)}
        />
        <ChevronDown className="cr-select-chevron" aria-hidden="true" size={13} strokeWidth={1.75} />
      </span>
    </span>
  );
}
