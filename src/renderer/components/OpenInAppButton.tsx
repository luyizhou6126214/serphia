import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ExternalLink, FolderOpen, LoaderCircle } from "lucide-react";
import type { OpenInAppApplication } from "@contract/desktop";
import { AnimatedDropdown } from "@/components/sidebar/WorkspaceDropdown";
import { useI18n } from "@/i18n";
import {
  describeOpenInApps,
  readOpenInAppChoice,
  selectOpenInApp,
  writeOpenInAppChoice,
  type OpenInAppChoice,
} from "@/lib/open-in-app";

const MENU_WIDTH = 232;
const FAILED_FEEDBACK_MS = 4_000;
const FILE_MANAGER_IDS = new Set(["explorer", "finder", "filemanager"]);

// One availability read per renderer life: every mount of the control (the
// Session header remounts around Settings) shares the Host's answer.
let cachedApplications: readonly OpenInAppApplication[] | null = null;
let pendingApplications: Promise<readonly OpenInAppApplication[]> | null = null;

async function loadApplications(): Promise<readonly OpenInAppApplication[]> {
  if (cachedApplications !== null) return cachedApplications;
  if (pendingApplications !== null) return pendingApplications;
  pendingApplications = (async () => {
    try {
      const bridge = window.piBridge;
      if (!bridge?.listOpenInApps) return [];
      const answer = await bridge.listOpenInApps();
      const applications = Array.isArray(answer)
        ? answer.filter((application) => typeof application?.id === "string" && application.id !== "")
        : [];
      cachedApplications = applications;
      return applications;
    } catch {
      // An unreachable Host reads as no applications: the control stays hidden
      // instead of rendering a broken button.
      return [];
    } finally {
      pendingApplications = null;
    }
  })();
  return pendingApplications;
}

/** Forget the cached availability read; used by tests and after a stale launch. */
export function resetOpenInAppApplications(): void {
  cachedApplications = null;
  pendingApplications = null;
}

function ApplicationIcon({ application, size }: { application: OpenInAppChoice; size: number }): ReactNode {
  const [failed, setFailed] = useState(false);
  if (application.icon === null || failed) {
    return FILE_MANAGER_IDS.has(application.id) ? (
      <FolderOpen size={size} strokeWidth={1.7} aria-hidden="true" />
    ) : (
      <ExternalLink size={size} strokeWidth={1.7} aria-hidden="true" />
    );
  }
  return (
    <img
      className="open-in-app-icon"
      src={application.icon}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** The application menu itself, separated from the portal so it stays renderable in isolation. */
export function OpenInAppMenu({
  applications,
  preferredId,
  onSelect,
  onEscape,
  panelRef,
}: {
  applications: readonly OpenInAppChoice[];
  preferredId: string;
  onSelect: (application: OpenInAppChoice) => void;
  onEscape: () => void;
  panelRef?: React.Ref<HTMLDivElement>;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div
      ref={panelRef}
      className="open-in-app-panel"
      role="menu"
      aria-label={t("openInAppMore", "Open in another application")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onEscape();
      }}
    >
      {applications.map((application) => {
        const current = application.id === preferredId;
        return (
          <button
            key={application.id}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            className={`open-in-app-item${current ? " is-current" : ""}`}
            onClick={() => onSelect(application)}
            title={application.name}
            autoFocus={current}
          >
            <span className="open-in-app-item-icon">
              <ApplicationIcon application={application} size={16} />
            </span>
            <span className="open-in-app-item-name">
              {current ? t("openInAppDefault", "{app} (default)").replace("{app}", application.name) : application.name}
            </span>
            {current && <Check className="open-in-app-item-check" size={14} strokeWidth={2.4} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

interface OpenInAppPosition {
  top: number;
  left: number;
}

/**
 * Session-header split button: the main half opens the workspace in the
 * remembered application, the chevron lists every application the Host
 * verified. Renders nothing without a workspace directory or an application.
 */
export function OpenInAppButton({ directory }: { directory: string | null }) {
  const { t } = useI18n();
  const [hostApplications, setHostApplications] = useState<readonly OpenInAppApplication[]>(
    () => cachedApplications ?? [],
  );
  const [choice, setChoice] = useState<string | null>(() => readOpenInAppChoice());
  const [menuOpen, setMenuOpen] = useState(false);
  const [position, setPosition] = useState<OpenInAppPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (directory === null || !window.piBridge?.listOpenInApps) return;
    let cancelled = false;
    void loadApplications().then((applications) => {
      if (!cancelled) setHostApplications(applications);
    });
    return () => {
      cancelled = true;
    };
  }, [directory]);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), FAILED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  useEffect(() => {
    if (!menuOpen) {
      setPosition(null);
      return;
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) chevronRef.current?.focus();
  }, []);

  const launch = useCallback(
    (application: OpenInAppChoice): void => {
      const bridge = window.piBridge;
      if (directory === null || !bridge?.openInApp || inFlight.current) return;
      inFlight.current = true;
      setMenuOpen(false);
      setBusy(true);
      setFailed(false);
      void bridge
        .openInApp(application.id, directory)
        .then((result) => {
          if (result?.ok === true) {
            setChoice(application.id);
            writeOpenInAppChoice(application.id);
            return;
          }
          setFailed(true);
          if (result?.ok === false && result.code === "NOT_INSTALLED") {
            // The launcher vanished after discovery: drop the stale list so the
            // control stops offering an application this host no longer holds.
            resetOpenInAppApplications();
            void loadApplications().then(setHostApplications);
          }
        })
        .catch(() => setFailed(true))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [directory],
  );

  const applications = describeOpenInApps(hostApplications, t);
  const preferred = selectOpenInApp(applications, choice);
  if (directory === null || preferred === undefined) return null;

  const title = busy
    ? t("openInAppOpening", "Opening…")
    : failed
      ? t("openInAppFailed", "Could not open the project in that application.")
      : t("openInAppOpenWith", "Open in {app}").replace("{app}", preferred.name);
  const moreLabel = t("openInAppMore", "Open in another application");

  return (
    <div className="open-in-app" ref={anchorRef}>
      <div className="open-in-app-split" data-failed={failed ? "" : undefined}>
        <button
          type="button"
          className="open-in-app-main"
          onClick={() => launch(preferred)}
          disabled={busy}
          title={title}
          aria-label={title}
        >
          {busy ? (
            <LoaderCircle className="open-in-app-spinner" size={17} aria-hidden="true" />
          ) : (
            <ApplicationIcon application={preferred} size={17} />
          )}
        </button>
        {applications.length > 1 && (
          <button
            ref={chevronRef}
            type="button"
            className="open-in-app-chevron"
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !menuOpen) return;
              event.preventDefault();
              closeMenu(true);
            }}
            disabled={busy}
            title={moreLabel}
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen && !busy}
          >
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
      {failed && (
        <span className="dsh-visually-hidden" role="status">
          {t("openInAppFailed", "Could not open the project in that application.")}
        </span>
      )}
      {typeof document === "undefined"
        ? null
        : createPortal(
            <AnimatedDropdown
              open={menuOpen}
              className="open-in-app-menu"
              transformOrigin="top right"
              style={{
                position: "fixed",
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                width: MENU_WIDTH,
                visibility: position ? "visible" : "hidden",
                zIndex: 1200,
              }}
            >
              <OpenInAppMenu
                applications={applications}
                preferredId={preferred.id}
                onSelect={launch}
                onEscape={() => closeMenu(true)}
                panelRef={panelRef}
              />
            </AnimatedDropdown>,
            document.body,
          )}
    </div>
  );
}
