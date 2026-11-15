import type { WebContents } from "electron";
import type { BrowserElementReference } from "../../contract/browser.ts";
import { redactBrowserText } from "./browser-redaction.ts";

type PickedElement = Omit<BrowserElementReference, "url">;
const PICKER_WORLD_ID = 99_912;

export async function pickBrowserElement(
  contents: WebContents,
  signal: AbortSignal,
  requestId: string,
): Promise<PickedElement | null> {
  const id = JSON.stringify(requestId);
  const run = (code: string) => contents.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [{ code }]);
  const cancel = () => {
    if (!contents.isDestroyed()) void run(`globalThis.__serphiaElementPick?.get(${id})?.()`).catch(() => undefined);
  };
  let resolveCancelled: (value: null) => void;
  const cancelled = new Promise<null>((resolve) => {
    resolveCancelled = resolve;
  });
  const onCancel = () => {
    cancel();
    resolveCancelled(null);
  };
  signal.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(onCancel, 120_000);
  try {
    contents.focus();
    const result: PickedElement | null = await Promise.race([
      run(`(${SELECT_ELEMENT_IN_PAGE})(${id})`).catch((error) => {
        if (signal.aborted) return null;
        throw error;
      }),
      cancelled,
    ]);
    if (!result) return null;
    return {
      selector: result.selector,
      tag: result.tag,
      ...(result.label ? { label: redactBrowserText(result.label, 160) } : {}),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCancel);
  }
}

/** Fixed script for Chromium's isolated world. Only the request ID is passed in. */
const SELECT_ELEMENT_IN_PAGE = String.raw`(requestId) => {
  const picks = (globalThis.__serphiaElementPick ??= new Map());
  for (const cancel of picks.values()) cancel();
  const shield = document.createElement("div");
  shield.setAttribute("aria-hidden", "true");
  Object.assign(shield.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    margin: "0",
    padding: "0",
    border: "none",
    width: "auto",
    height: "auto",
    background: "transparent",
  });
  const marker = document.createElement("div");
  Object.assign(marker.style, {
    position: "fixed",
    boxSizing: "border-box",
    pointerEvents: "none",
    display: "none",
    border: "2px solid #387bff",
    borderRadius: "3px",
    background: "rgba(56, 123, 255, .16)",
  });
  shield.attachShadow({ mode: "closed" }).append(marker);
  shield.popover = "manual";
  document.documentElement.append(shield);
  try {
    shield.showPopover();
  } catch {
    shield.removeAttribute("popover");
  }

  function hit(event) {
    shield.style.pointerEvents = "none";
    try {
      let element = document.elementFromPoint(event.clientX, event.clientY);
      while (element?.shadowRoot) {
        const child = element.shadowRoot.elementFromPoint(event.clientX, event.clientY);
        if (!child || child === element) break;
        element = child;
      }
      return element;
    } finally {
      shield.style.pointerEvents = "auto";
    }
  }

  function selectorInRoot(target, root) {
    const parts = [];
    for (let element = target; element; element = element.parentElement) {
      for (const attribute of ["id", "data-testid", "data-test", "data-cy", "data-test-id"]) {
        const value = element.getAttribute(attribute);
        if (!value || value.length > 96) continue;
        const escaped = CSS.escape(value);
        const selector = attribute === "id" ? "#" + escaped : "[" + attribute + "=" + escaped + "]";
        if (root.querySelectorAll(selector).length === 1) return [selector, ...parts].join(" > ");
      }
      const tag = CSS.escape(element.localName);
      const siblings = Array.from(element.parentNode?.children ?? []).filter(
        (child) => child.localName === element?.localName,
      );
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(element) + 1) + ")" : tag);
    }
    return parts.join(" > ");
  }

  function describe(target) {
    const selectors = [];
    let element = target;
    for (;;) {
      const root = element.getRootNode();
      selectors.unshift(selectorInRoot(element, root));
      if (!(root instanceof ShadowRoot)) break;
      element = root.host;
    }
    const ownText = Array.from(target.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent?.slice(0, 160))
      .join(" ");
    const editable = target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const label = (target.getAttribute("aria-label") || target.getAttribute("alt") || (!editable && ownText) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return { selector: selectors.join(" >> ").slice(0, 1024), tag: target.localName.slice(0, 80), label };
  }

  return new Promise((resolve) => {
    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    let finished = false;
    let pressed = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      listeners.abort();
      picks.delete(requestId);
      shield.remove();
      resolve(result);
    };
    picks.set(requestId, () => finish(null));
    const block = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener(
      "pointermove",
      (event) => {
        if (!event.isTrusted || event.target !== shield) return;
        const rect = hit(event)?.getBoundingClientRect();
        marker.style.display = rect ? "block" : "none";
        if (!rect) return;
        Object.assign(marker.style, {
          left: rect.left + "px",
          top: rect.top + "px",
          width: rect.width + "px",
          height: rect.height + "px",
        });
      },
      options,
    );
    for (const type of ["mousedown", "mouseup", "click", "contextmenu"]) {
      window.addEventListener(
        type,
        (event) => {
          if (event.target === shield) block(event);
        },
        options,
      );
    }
    window.addEventListener("pointerdown", (event) => {
      if (!event.isTrusted || event.target !== shield) return;
      block(event);
      pressed = event.button === 0;
    }, options);
    window.addEventListener("pointerup", (event) => {
      if (!event.isTrusted || event.target !== shield) return;
      block(event);
      if (!pressed || event.button !== 0) return;
      pressed = false;
      const target = hit(event);
      if (target) {
        const result = describe(target);
        // Keep the shield in place until the compatibility click has been consumed.
        setTimeout(() => finish(result), 0);
      }
    }, options);
    window.addEventListener(
      "keydown",
      (event) => {
        if (!event.isTrusted || event.key !== "Escape") return;
        block(event);
        finish(null);
      },
      options,
    );
    window.addEventListener("pagehide", () => finish(null), options);
  });
}`;
