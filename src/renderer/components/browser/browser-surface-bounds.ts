type RectangleEdges = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;
type PanelBorders = Pick<
  CSSStyleDeclaration,
  "borderLeftWidth" | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth"
>;

/** Native views are not clipped by the renderer's overflow rules. */
export function browserSurfaceBounds(
  surface: RectangleEdges,
  panel: RectangleEdges,
  borders?: PanelBorders,
): { x: number; y: number; width: number; height: number } | null {
  // Clip inside the panel border, matching the renderer's overflow clip.
  const panelLeft = Math.ceil(panel.left + (borders ? parseFloat(borders.borderLeftWidth) : 0));
  const panelTop = Math.ceil(panel.top + (borders ? parseFloat(borders.borderTopWidth) : 0));
  const panelRight = Math.floor(panel.right - (borders ? parseFloat(borders.borderRightWidth) : 0));
  const panelBottom = Math.floor(panel.bottom - (borders ? parseFloat(borders.borderBottomWidth) : 0));
  if (
    ![panelLeft, panelTop, panelRight, panelBottom].every(Number.isFinite) ||
    panelRight <= panelLeft ||
    panelBottom <= panelTop
  )
    return null;
  const left = Math.max(Math.ceil(surface.left), panelLeft);
  const top = Math.max(Math.ceil(surface.top), panelTop);
  const right = Math.min(Math.floor(surface.right), panelRight);
  const bottom = Math.min(Math.floor(surface.bottom), panelBottom);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    // Keep a stale native view inside the panel until the surface is laid out again.
    return { x: panelLeft, y: panelTop, width: 1, height: 1 };
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
