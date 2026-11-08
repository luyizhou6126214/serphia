import { ArrowLeftOutlined } from "@ant-design/icons/es";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";
import { useI18n } from "@/i18n";

type SettingsConfigModule = { default: typeof import("./SettingsConfig").SettingsConfig };

let settingsConfigLoad: Promise<SettingsConfigModule> | null = null;

// Shared by the idle/hover preload and React.lazy so the chunk is fetched once; a failed preload resets so the
// next attempt (including the click itself) retries.
export function preloadSettingsConfig(): Promise<SettingsConfigModule> {
  settingsConfigLoad ??= import("./SettingsConfig").then(
    (module) => ({ default: module.SettingsConfig }),
    (error: unknown) => {
      settingsConfigLoad = null;
      throw error;
    },
  );
  return settingsConfigLoad;
}

export function scheduleSettingsConfigPreload(): () => void {
  const handle = window.requestIdleCallback(
    () => {
      void preloadSettingsConfig().catch(() => undefined);
    },
    { timeout: 5000 },
  );
  return () => window.cancelIdleCallback(handle);
}

const LazySettingsConfig = lazy(preloadSettingsConfig);
const LazyTerminalPanel = lazy(() =>
  import("./terminal/TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);

function PanelLoading() {
  const { t } = useI18n();
  return (
    <div role="status" style={{ padding: 16 }}>
      {t("loading", "Loading…")}
    </div>
  );
}

// Keep the page layout stable while the settings bundle loads.
function SettingsLoading({
  onClose,
  returnFocusTarget,
  navigationOpen = true,
}: {
  onClose: () => void;
  returnFocusTarget: HTMLElement | null;
  navigationOpen?: boolean;
}) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const initiallyOpenNavigationRef = useRef(navigationOpen);
  useEffect(() => {
    if (initiallyOpenNavigationRef.current) closeButtonRef.current?.focus();
    return () => {
      returnFocusTarget?.focus();
    };
  }, [returnFocusTarget]);
  return (
    <div
      className="settings-page"
      aria-busy="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <aside
        className="settings-page-nav"
        aria-hidden={!navigationOpen || undefined}
        inert={!navigationOpen || undefined}
      >
        <div className="settings-page-nav-header">
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-page-back"
            onClick={onClose}
            aria-label={t("settingsBack", "Back to chats")}
          >
            <ArrowLeftOutlined />
          </button>
          <span>{t("settings", "Settings")}</span>
        </div>
      </aside>
      <main className="settings-page-main">
        <div role="status" className="settings-page-loading">
          {t("loading", "Loading…")}
        </div>
      </main>
    </div>
  );
}

export function SettingsConfig(props: Omit<ComponentProps<typeof LazySettingsConfig>, "returnFocusTarget">) {
  // Restore focus to the original opener after leaving Settings.
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return (
    <Suspense
      fallback={
        <SettingsLoading
          onClose={props.onClose}
          returnFocusTarget={returnFocusTarget}
          navigationOpen={props.navigationOpen}
        />
      }
    >
      <LazySettingsConfig {...props} returnFocusTarget={returnFocusTarget} />
    </Suspense>
  );
}

export function TerminalPanel(props: ComponentProps<typeof LazyTerminalPanel>) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <LazyTerminalPanel {...props} />
    </Suspense>
  );
}
