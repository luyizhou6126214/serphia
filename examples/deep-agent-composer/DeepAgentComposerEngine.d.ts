import type { ComponentType, ReactNode } from "react";
import type { MotionController, MotionOptions } from "./motion-runtime";

export type Effort = "simple" | "medium" | "deep";
export type Permission = "default" | "auto_review" | "full_access";

export interface ReasoningEffortSliderOptions extends MotionOptions {
  value?: Effort;
  onValueChange?: (value: Effort) => void;
  disabled?: boolean;
}

export interface ComposerMessage {
  text: string;
  model: string;
  thinking: Effort;
  attachments: {
    id: string;
    name: string;
    kind: string;
    status: string;
    file?: File;
    mime?: string;
    size?: number;
    dataUrl?: string;
    extractedText?: string;
  }[];
  skills: unknown[];
  mentions: unknown[];
  permission: Permission;
}

export interface DeepAgentComposerOptions extends ReasoningEffortSliderOptions {
  models?: string[];
  selectedModel?: string;
  onModelChange?: (model: string) => void | Promise<void>;
  busy?: boolean;
  stopping?: boolean;
  onStop?: () => void | Promise<void>;
  onPermissionChange?: (permission: Permission) => void | Promise<void>;
  onSubmit?: (message: ComposerMessage) => void | Promise<void>;
}

export function mountDeepAgentComposer(
  target: HTMLElement,
  options?: DeepAgentComposerOptions,
): MotionController<DeepAgentComposerOptions>;
export function mountReasoningEffortSlider(
  target: HTMLElement,
  options?: ReasoningEffortSliderOptions,
): MotionController<ReasoningEffortSliderOptions>;

type MenuIcon = ComponentType<{ size?: number; className?: string }>;

export interface ApprovalOption<T extends string> {
  id: T;
  label: string;
  desc: string;
  icon: MenuIcon;
}

interface MenuProps {
  open: boolean;
  disabled?: boolean;
  menuLabel: string;
  onOpenChange: (open: boolean) => void;
}

export interface ApprovalMenuProps<T extends string> extends MenuProps {
  layoutId: string;
  compact?: boolean;
  visibleOptions: readonly ApprovalOption<T>[];
  selectedApproval: ApprovalOption<T>;
  chooseApproval: (option: ApprovalOption<T>) => void;
  error?: string;
}

export interface ModelThinkingSelectorProps<T extends string> extends MenuProps {
  models: string[];
  selectedModel?: string;
  selectedThinking: T;
  thinkingOptions: { id: T; label: string; icon: MenuIcon }[];
  selectModelLabel: string;
  noModelsLabel: string;
  onChooseModel: (id: string) => void;
  onChooseThinking: (id: T) => void;
  getModelLabel: (id: string) => string;
  getModelGroup?: (id: string) => string | undefined;
  modelsLabel: string;
  reasoningLabel: string;
  modelStatus?: ReactNode;
  thinkingDisabled?: boolean;
  showThinking?: boolean;
}

export function createDeepAgentMenuScope(target: HTMLElement): {
  mountPoint: HTMLElement;
  parts: {
    ApprovalMenu: <T extends string>(props: ApprovalMenuProps<T>) => ReactNode;
    ModelThinkingSelector: <T extends string>(props: ModelThinkingSelectorProps<T>) => ReactNode;
  };
  destroy(): void;
};
