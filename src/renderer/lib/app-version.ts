/**
 * App / pi library versions for the renderer.
 * Injected by Vite `define` — never use Node `process` in renderer code.
 */
export const APP_VERSION =
  (typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION) ||
  "0.0.1";

export const PI_VERSION =
  (typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: { VITE_PI_VERSION?: string } }).env?.VITE_PI_VERSION) ||
  "unknown";

export const APP_DISPLAY_NAME = "Serphia";
export const APP_AUTHOR = "luyizhou";
export const APP_GITHUB_URL = "https://github.com/luyizhou6126214/serphia";
