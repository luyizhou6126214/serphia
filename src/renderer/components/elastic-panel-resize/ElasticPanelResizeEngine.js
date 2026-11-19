// Interaction reference: LeiBox Elastic Panel Resize (design reference: Alvish).
// https://leibox.pantoria.cn/docs/animations/elastic-panel-resize
const DESIGN_WIDTH = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const dividerStyles = `
  :host {
    display: block; position: absolute; top: 0; bottom: 0; width: 32px;
    transform: translateX(-50%); z-index: 5; pointer-events: auto;
    cursor: ew-resize; touch-action: none; user-select: none; outline: none;
    -webkit-app-region: no-drag; -webkit-tap-highlight-color: transparent;
  }
  svg, .focus {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%); pointer-events: none;
  }
  :host(:focus-visible) .focus {
    box-sizing: border-box; width: 48px; height: 132px;
    border: 2px solid #666; border-radius: 24px;
  }
`;

const sceneStyles = `
  .scene {
    position: relative; display: block; width: 100%; aspect-ratio: 1;
    isolation: isolate; overflow: clip; background: #efefef;
  }
  .scene::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Cpath filter='url(%23n)' d='M0 0h160v160H0z'/%3E%3C/svg%3E");
    background-size: 160px 160px; mix-blend-mode: soft-light;
    filter: contrast(4); opacity: .65;
  }
  .panel {
    position: absolute; inset: 17px 17px 17px 38.65%;
    box-sizing: border-box; border: 1px solid #d4d4d4; border-radius: 40px;
    background: #fbfbfb; box-shadow: 0 2px 4px #0000000a, inset 0 0 0 1px #ffffffb3;
  }
`;

function addStyle(root, css) {
  const style = root.ownerDocument.createElement("style");
  style.textContent = css;
  root.append(style);
}

function spring(state, target, stiffness, damping, step) {
  state.velocity += ((target - state.value) * stiffness - state.velocity * damping) * step;
  state.value += state.velocity * step;
}

function settled(state, target, velocity = 0.03) {
  return Math.abs(state.value - target) < 0.01 && Math.abs(state.velocity) < velocity;
}

/** Mount a divider in an existing layout. Range and position are local x-coordinates. */
export function mountElasticDivider(host, options) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const { reference, panel, getRange, onPosition, onCommit, getValue, label, anchored, onDragChange, side } = options;
  const restingThickness = options.restingThickness ?? 15;
  const restingLength = 75 - restingThickness;
  const handle = doc.createElement("div");
  handle.style.left = "0px";
  const root = handle.attachShadow({ mode: "open" });
  addStyle(root, dividerStyles);
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-controls", panel.id);
  handle.setAttribute("aria-label", label || "Panel width");

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "80");
  svg.setAttribute("height", "160");
  svg.setAttribute("viewBox", "0 0 80 160");
  svg.setAttribute("aria-hidden", "true");
  const outline = doc.createElementNS(SVG_NS, "path");
  const stroke = doc.createElementNS(SVG_NS, "path");
  for (const path of [outline, stroke]) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    svg.append(path);
  }
  outline.setAttribute("stroke", "#fff");
  const focus = doc.createElement("span");
  focus.className = "focus";
  focus.setAttribute("aria-hidden", "true");
  root.append(svg, focus);
  const live = doc.createElement("span");
  live.style.cssText =
    "position:absolute;overflow:hidden;white-space:nowrap;width:1px;height:1px;clip-path:inset(50%);font-family:Arial,Helvetica,sans-serif";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  host.append(handle, live);

  const media = win.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new win.AbortController();
  const listenerOptions = { signal: listeners.signal };
  let motionOverride = options.reducedMotion;
  let width = reference.getBoundingClientRect().width || DESIGN_WIDTH;
  let range = getRange(width);
  let target = clamp(options.position ?? range.initial, range.min, range.max);
  const position = { value: target, velocity: 0 };
  const bend = { value: 0, velocity: 0 };
  const offset = { value: 0, velocity: 0 };
  let length = restingLength;
  let thickness = 0;
  let opacity = 0;
  let drag = null;
  let hovering = false;
  let focused = false;
  let shown = false;
  let hideTimer = 0;
  let frame = 0;
  let previousFrame = null;
  let paintedPosition;
  let paintedWidth;
  let destroyed = false;

  const reduced = () => motionOverride ?? media.matches;

  function syncValue(announce = false) {
    const value = getValue?.(target, width, range) ?? {
      min: 100 * (1 - range.max / width),
      max: 100 * (1 - range.min / width),
      now: 100 * (1 - target / width),
    };
    const now = (Math.round((value.now + 1e-9) * 10) / 10).toFixed(1);
    const text = value.text ?? `Panel width ${now}%`;
    handle.setAttribute("aria-valuemin", String(Number(value.min.toFixed(1))));
    handle.setAttribute("aria-valuemax", String(Number(value.max.toFixed(1))));
    handle.setAttribute("aria-valuenow", now);
    handle.setAttribute("aria-valuetext", text);
    if (announce) live.replaceChildren(text);
  }

  function paintPosition() {
    if (paintedPosition === position.value && paintedWidth === width) return;
    paintedPosition = position.value;
    paintedWidth = width;
    if (!anchored) handle.style.left = `${position.value}px`;
    onPosition(position.value, width);
  }

  function paintHandle(intensity) {
    const x = 40 + offset.value;
    const path = `M${x} ${80 - length / 2} Q${x + 2 * bend.value} 80 ${x} ${80 + length / 2}`;
    outline.setAttribute("d", path);
    stroke.setAttribute("d", path);
    outline.setAttribute("stroke-width", String(thickness + 2 * opacity));
    stroke.setAttribute("stroke-width", String(thickness));
    const gray = Math.round(198 - 39 * intensity);
    stroke.setAttribute("stroke", `rgb(${gray} ${gray} ${gray})`);
    svg.style.opacity = String(opacity);
  }

  function schedule() {
    if (!destroyed && !frame) frame = win.requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min((now - (previousFrame ?? now)) / 1000, 1 / 30);
    previousFrame = now;
    const still = reduced();
    const speed = drag && now - drag.lastMove <= 70 ? drag.speed : 0;
    const direction = still ? 0 : clamp(speed / 60, -1, 1);
    const excess = still ? 0 : (drag?.excess ?? 0);
    const overpull = clamp(Math.abs(excess) / 80, 0, 1);
    const intensity = Math.max(Math.abs(direction) * (1 - overpull), overpull);
    const nextBend = 4.5 * direction * (1 - overpull);
    const nextOffset = 9 * direction * (1 - overpull) + 6 * Math.sign(excess) * overpull;
    const nextLength = restingLength + (90 - restingLength) * intensity + 21 * overpull;
    const nextOpacity = Number(shown);
    const nextThickness = (restingThickness - (restingThickness - 5) * intensity - 2 * overpull) * nextOpacity;

    for (let step = 0; step < 4 && !still; step++) {
      if (!drag) spring(position, target, 400, 26, dt / 4);
      spring(bend, nextBend, 680, 34, dt / 4);
      spring(offset, nextOffset, 680, 34, dt / 4);
    }
    if (still) {
      position.value = target;
      position.velocity = 0;
      bend.value = bend.velocity = offset.value = offset.velocity = 0;
    }

    const alpha = still ? 1 : 1 - Math.exp(-32 * dt);
    length += (nextLength - length) * alpha;
    thickness += (nextThickness - thickness) * alpha;
    opacity += (nextOpacity - opacity) * alpha;

    const idle =
      !speed &&
      (drag || settled(position, target, 0.05)) &&
      settled(bend, nextBend) &&
      settled(offset, nextOffset) &&
      Math.abs(length - nextLength) < 0.01 &&
      Math.abs(thickness - nextThickness) < 0.01 &&
      Math.abs(opacity - nextOpacity) < 0.001;
    if (idle) {
      if (!drag) position.value = target;
      position.velocity = bend.velocity = offset.velocity = 0;
      bend.value = nextBend;
      offset.value = nextOffset;
      length = nextLength;
      thickness = nextThickness;
      opacity = nextOpacity;
      previousFrame = null;
    } else {
      schedule();
    }
    paintPosition();
    paintHandle(intensity);
  }

  function updateVisibility() {
    win.clearTimeout(hideTimer);
    hideTimer = 0;
    if (hovering || focused || drag) {
      shown = true;
      schedule();
    } else if (shown) {
      hideTimer = win.setTimeout(() => {
        hideTimer = 0;
        shown = false;
        schedule();
      }, 450);
    }
  }

  function setTarget(value, announce, commit = announce) {
    target = clamp(value, range.min, range.max);
    if (reduced()) {
      position.value = target;
      position.velocity = 0;
      paintPosition();
    }
    syncValue(announce);
    if (commit) onCommit?.(target, width);
    schedule();
  }

  function resize() {
    const rect = reference.getBoundingClientRect();
    const nextWidth = rect.width;
    if (nextWidth <= 0) return;
    const nextRange = getRange(nextWidth);
    if (
      nextWidth === width &&
      nextRange.min === range.min &&
      nextRange.max === range.max &&
      nextRange.initial === range.initial
    )
      return;
    const ratio = anchored ? 1 : nextWidth / width;
    const shift = anchored && side !== "left" ? nextWidth - width : 0;
    width = nextWidth;
    range = nextRange;
    target = clamp(target * ratio + shift, range.min, range.max);
    position.value = position.value * ratio + shift;
    position.velocity *= ratio;
    if (drag) {
      drag.before = clamp(drag.before * ratio + shift, range.min, range.max);
      drag.raw = drag.raw * ratio + shift;
      drag.grab = drag.clientX - rect.left - drag.raw;
      drag.excess = drag.raw - target;
      position.value = visiblePosition(drag.excess);
    }
    if (reduced()) position.value = target;
    paintPosition();
    syncValue();
    schedule();
  }

  function visiblePosition(excess) {
    return target + (reduced() ? 0 : Math.sign(excess) * 15 * (1 - Math.exp(-Math.abs(excess) / 35)));
  }

  function refreshHover(event) {
    const rect = handle.getBoundingClientRect();
    hovering =
      event.pointerType !== "touch" &&
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom;
  }

  function start(event) {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    resize();
    const localX = event.clientX - reference.getBoundingClientRect().left;
    handle.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      before: target,
      grab: localX - position.value,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
      raw: position.value,
      excess: position.value - target,
      speed: 0,
      lastMove: event.timeStamp,
    };
    position.velocity = 0;
    onDragChange?.(true);
    event.preventDefault();
    updateVisibility();
  }

  function move(event) {
    if (drag?.id !== event.pointerId) return;
    const raw = event.clientX - reference.getBoundingClientRect().left - drag.grab;
    drag.speed = clamp((raw - drag.raw) / Math.max((event.timeStamp - drag.lastMove) / 1000, 0.008), -2200, 2200);
    drag.lastMove = event.timeStamp;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (raw === drag.raw) {
      schedule();
      return;
    }
    drag.raw = raw;
    target = clamp(raw, range.min, range.max);
    drag.excess = raw - target;
    position.value = visiblePosition(drag.excess);
    paintPosition();
    syncValue();
    schedule();
  }

  function finish(event, cancel = false, outside = false) {
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const { id, before } = drag;
    refreshHover(event?.type === "pointerup" ? event : drag);
    if (outside) hovering = false;
    drag = null;
    position.velocity = 0;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    setTarget(cancel ? before : target, true, !cancel && Math.abs(target - before) > 0.01);
    onDragChange?.(false);
    updateVisibility();
  }

  function onKey(event) {
    if (drag) return;
    const step = (event.shiftKey ? 0.06 : 0.02) * width;
    const leftPanel = options.side === "left";
    const keys = {
      ArrowLeft: target - step,
      ArrowRight: target + step,
      Home: leftPanel ? range.max : range.min,
      End: leftPanel ? range.min : range.max,
      Escape: range.initial,
    };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    setTarget(keys[event.key], true);
  }

  function onEscape(event) {
    if (event.key !== "Escape" || !drag) return;
    finish(null, true);
    event.preventDefault();
    event.stopPropagation();
  }

  handle.addEventListener(
    "pointerenter",
    (event) => {
      if (!drag && event.pointerType !== "touch") hovering = true;
      updateVisibility();
    },
    listenerOptions,
  );
  handle.addEventListener(
    "pointerleave",
    () => {
      hovering = false;
      updateVisibility();
    },
    listenerOptions,
  );
  handle.addEventListener("pointerdown", start, listenerOptions);
  // Desktop webviews can retarget mouse input to another DOM element between
  // pointerdown and the first captured move. Track the active pointer there too.
  const captureOptions = { ...listenerOptions, capture: true };
  win.addEventListener("pointermove", move, captureOptions);
  win.addEventListener("pointerup", (event) => finish(event), captureOptions);
  win.addEventListener("pointercancel", (event) => finish(event, true, true), captureOptions);
  handle.addEventListener("lostpointercapture", (event) => finish(event), listenerOptions);
  handle.addEventListener(
    "focus",
    () => {
      focused = true;
      updateVisibility();
    },
    listenerOptions,
  );
  handle.addEventListener(
    "blur",
    () => {
      focused = false;
      updateVisibility();
    },
    listenerOptions,
  );
  handle.addEventListener("keydown", onKey, listenerOptions);
  handle.addEventListener(
    "dblclick",
    (event) => {
      if (event.button === 0 && !drag) setTarget(range.initial, true);
    },
    listenerOptions,
  );
  win.addEventListener("keydown", onEscape, captureOptions);
  win.addEventListener(
    "blur",
    () => {
      hovering = false;
      finish(null, true, true);
      updateVisibility();
    },
    listenerOptions,
  );
  media.addEventListener("change", schedule, listenerOptions);
  const observer = new win.ResizeObserver(resize);
  observer.observe(reference);

  syncValue();
  paintPosition();
  paintHandle(0);

  return {
    update(next = {}) {
      if (destroyed) return;
      motionOverride = next.reducedMotion;
      if (next.label !== undefined) handle.setAttribute("aria-label", next.label);
      resize();
      if (!drag && next.position !== undefined) {
        const desired = clamp(next.position, range.min, range.max);
        if (Math.abs(desired - target) > 0.01) {
          target = position.value = desired;
          position.velocity = 0;
          paintPosition();
        }
      }
      syncValue();
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.abort();
      observer.disconnect();
      win.cancelAnimationFrame(frame);
      win.clearTimeout(hideTimer);
      if (drag && handle.hasPointerCapture(drag.id)) handle.releasePointerCapture(drag.id);
      if (drag) onDragChange?.(false);
      drag = null;
      handle.remove();
      live.remove();
    },
  };
}

export function mountElasticPanelResize(host, options = {}) {
  const doc = host.ownerDocument;
  const wrapper = doc.createElement("div");
  const root = wrapper.attachShadow({ mode: "open" });
  addStyle(root, sceneStyles);
  const scene = doc.createElement("div");
  scene.className = "scene";
  const panel = doc.createElement("div");
  panel.className = "panel";
  panel.id = "elastic-panel";
  const dividerHost = doc.createElement("div");
  dividerHost.style.cssText = "position:absolute;inset:17px 0;pointer-events:none";
  scene.append(panel, dividerHost);
  root.append(scene);
  host.append(wrapper);

  function setHeight(height) {
    scene.style.height = typeof height === "number" ? `${height}px` : (height ?? "");
  }
  setHeight(options.height);
  const divider = mountElasticDivider(dividerHost, {
    reference: scene,
    panel,
    getRange: (width) => ({ min: 0.276 * width, max: 0.5 * width, initial: 0.3865 * width }),
    onPosition: (position) => {
      panel.style.left = `${position}px`;
    },
    reducedMotion: options.reducedMotion,
  });
  return {
    update(next = {}) {
      setHeight(next.height);
      divider.update(next);
    },
    destroy() {
      divider.destroy();
      wrapper.remove();
    },
  };
}
