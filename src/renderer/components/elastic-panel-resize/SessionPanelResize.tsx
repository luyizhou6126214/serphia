import { useLayoutEffect, useRef, type RefObject } from "react";
import { mountElasticDivider } from "./ElasticPanelResizeEngine.js";

interface PanelWidths {
  minWidth: number;
  maxWidth: number;
}

interface SessionPanelResizeProps {
  side: "left" | "right";
  panelRef: RefObject<HTMLDivElement | null>;
  width: number;
  defaultWidth: number;
  bounds(workspaceWidth: number): PanelWidths;
  label: string;
  formatWidth(width: number): string;
  onCommit(width: number): void;
  onDragChange?(dragging: boolean): void;
}

export function SessionPanelResize(props: SessionPanelResizeProps) {
  const { panelRef, side } = props;
  const edge = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const divider = useRef<ReturnType<typeof mountElasticDivider> | null>(null);
  const toPosition = useRef<((width: number) => number) | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);

  useLayoutEffect(() => {
    const host = edge.current;
    const reference = host?.parentElement;
    const panel = panelRef.current;
    if (!host || !reference || !panel) return;

    const right = side === "right";
    const inset = Number.parseFloat(getComputedStyle(reference).paddingRight) || 0;
    const leftOrigin = panel.getBoundingClientRect().left - reference.getBoundingClientRect().left;
    const variable = right ? "--right-panel-live-width" : "--sidebar-live-width";
    const widthOwner = right ? panel : (reference.parentElement ?? panel);
    const origin = (width: number) => (right ? width - inset : leftOrigin);
    const toWidth = (x: number, width: number) => (right ? origin(width) - x : x - origin(width));
    const positionFor = (width: number, panelWidth: number) => origin(width) + (right ? -panelWidth : panelWidth);
    toPosition.current = (panelWidth) => positionFor(reference.getBoundingClientRect().width, panelWidth);
    panel.setAttribute("data-elastic-resize", "");
    divider.current = mountElasticDivider(host, {
      reference,
      panel,
      side,
      anchored: true,
      restingThickness: 8,
      position: toPosition.current(latest.current.width),
      getRange(width) {
        const { minWidth, maxWidth } = latest.current.bounds(width);
        return {
          min: positionFor(width, right ? maxWidth : minWidth),
          max: positionFor(width, right ? minWidth : maxWidth),
          initial: positionFor(width, latest.current.defaultWidth),
        };
      },
      getValue(position, width, range) {
        const first = toWidth(range.min, width);
        const second = toWidth(range.max, width);
        const now = toWidth(position, width);
        return {
          min: Math.min(first, second),
          max: Math.max(first, second),
          now,
          text: latest.current.formatWidth(now),
        };
      },
      onPosition(position, width) {
        widthOwner.style.setProperty(variable, `${Math.max(0, toWidth(position, width))}px`);
      },
      onCommit(position, width) {
        latest.current.onCommit(toWidth(position, width));
      },
      onDragChange(dragging) {
        latest.current.onDragChange?.(dragging);
      },
    });
    return () => {
      divider.current?.destroy();
      divider.current = null;
      toPosition.current = null;
      panel.removeAttribute("data-elastic-resize");
      widthOwner.style.removeProperty(variable);
    };
  }, [panelRef, side]);

  const { bounds, defaultWidth, label, formatWidth, width } = props;
  useLayoutEffect(() => {
    divider.current?.update({ label });
  }, [bounds, defaultWidth, label, formatWidth]);

  useLayoutEffect(() => {
    divider.current?.update({ position: toPosition.current?.(width) });
  }, [width]);

  return <div ref={edge} className="session-panel-resize-edge" />;
}
