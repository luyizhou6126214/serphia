export const DESKTOP_WINDOW_AVAILABLE_ENV = "PI_DESKTOP_WINDOW_AVAILABLE";
export const DESKTOP_WINDOW_PROTOTYPE_TOOL = "desktop_window";

export type DesktopWindowAction =
  | { action: "bind"; app?: string }
  | { action: "snapshot" | "screenshot" | "stop" }
  | { action: "click"; ref: string }
  | { action: "input"; ref: string; text: string };

export type DesktopWindowResult = { data: unknown; image?: string };
