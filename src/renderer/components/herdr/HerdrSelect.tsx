import type { ReactNode, RefObject } from "react";
import { Select } from "deep-agent-base-ui/select";
import { Check, ChevronDown } from "lucide-react";

interface Props<Value extends string> {
  value: Value;
  onChange: (value: Value) => void;
  items: readonly { value: Value; label: string; icon: ReactNode; description?: string }[];
  label: string;
  disabled?: boolean;
  portal: RefObject<HTMLDivElement | null>;
  variant?: "workspace";
}

export function HerdrSelect<Value extends string>({
  value,
  onChange,
  items,
  label,
  disabled,
  portal,
  variant,
}: Props<Value>) {
  const selected = items.find((item) => item.value === value);
  return (
    <Select.Root<Value>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      disabled={disabled}
      modal={false}
    >
      <Select.Trigger className="hd-picker" data-variant={variant} aria-label={label} title={selected?.label}>
        {selected?.icon}
        <Select.Value className="hd-picker-value">{selected?.label}</Select.Value>
        <Select.Icon className="hd-picker-chevron">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={portal}>
        <Select.Positioner
          className="hd-picker-positioner"
          data-variant={variant}
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="hd-picker-popup">
            <Select.List className="hd-picker-list" aria-label={label}>
              {items.map(({ value, label, icon, description }) => (
                <Select.Item key={value} className="hd-picker-option" value={value} label={label}>
                  {icon}
                  <div className="hd-picker-option-copy">
                    <Select.ItemText className="hd-picker-option-name">{label}</Select.ItemText>
                    {description && (
                      <span className="hd-picker-option-path" title={description}>
                        {description}
                      </span>
                    )}
                  </div>
                  <Select.ItemIndicator className="hd-picker-check">
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
