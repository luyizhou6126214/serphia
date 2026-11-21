import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  loadRightPanelPreferredWidth,
  saveRightPanelPreferredWidth,
} from "@/lib/layout-preferences";

export function initialRightPanelPreferredWidth(): number {
  try {
    return loadRightPanelPreferredWidth(window.localStorage);
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

export function persistRightPanelPreferredWidth(width: number): void {
  try {
    saveRightPanelPreferredWidth(window.localStorage, width);
  } catch {
    // Storage can become unavailable after startup; keep the in-memory preference.
  }
}
