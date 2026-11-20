import {
  Component,
  lazy,
  Suspense,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { ensureRpc, resetRpc } from "@/lib/api-client";
import { useChatAppearance } from "@/hooks/useChatAppearance";

const AppShell = lazy(() => import("@/components/AppShell").then(({ AppShell }) => ({ default: AppShell })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pi-desktop] render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={centerStyle}>
          <div style={cardStyle}>
            <h1 style={titleStyle}>UI crashed</h1>
            <p style={bodyStyle}>{this.state.error.message}</p>
            <pre style={preStyle}>{this.state.error.stack}</pre>
            <button type="button" onClick={() => window.location.reload()} style={btnPrimary}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const chatAppearance = useChatAppearance();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let attempt = 0;

    const connect = () => {
      const current = ++attempt;
      void ensureRpc().then(
        () => {
          if (attempt === current) {
            setReady(true);
            setError(null);
          }
        },
        (err: unknown) => {
          if (attempt === current) {
            setError(err instanceof Error ? err.message : String(err));
            setReady(false);
          }
        },
      );
    };

    const offStatus = window.piBridge?.onHostStatus(({ status, detail }) => {
      if (status === "ready") return;
      ++attempt;
      resetRpc();
      setReady(false);
      if (status === "starting") {
        setError(null);
        connect();
      } else {
        setError(detail || `Agent Host ${status}`);
      }
    });
    connect();

    const offMenuDiag = window.piBridge?.onMenu?.("export-diagnostics", () => {
      void window.piBridge?.exportDiagnostics?.();
    });

    // Clear dock badge when user focuses the app
    const onFocus = () => window.piBridge?.clearBadge?.();
    window.addEventListener("focus", onFocus);

    return () => {
      ++attempt;
      offStatus?.();
      offMenuDiag?.();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Cannot connect to Agent Host</h1>
          <p style={bodyStyle}>{error}</p>
          <button type="button" onClick={() => window.location.reload()} style={btnPrimary}>
            Retry
          </button>
          <button type="button" onClick={() => void window.piBridge?.openLogs()} style={btnSecondary}>
            Open logs
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !chatAppearance.loaded) return <StartupScreen waitingForHost={!ready} />;

  return (
    <ErrorBoundary>
      <Suspense fallback={<StartupScreen />}>
        <AppShell
          chatAppearance={chatAppearance.preferences}
          chatAppearanceSaving={chatAppearance.saving}
          onChatAppearanceChange={chatAppearance.update}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

function StartupScreen({ waitingForHost = false }: { waitingForHost?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="startup-screen">
      <p role="status">
        {waitingForHost ? (slow ? "Agent Host is still starting…" : "Starting Agent Host…") : "Starting Serphia…"}
      </p>
      {slow && (
        <button type="button" onClick={() => void window.piBridge.openLogs()} style={btnSecondary}>
          Open logs
        </button>
      )}
    </div>
  );
}

const centerStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
};

const cardStyle: CSSProperties = {
  maxWidth: 520,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "28px 32px",
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  margin: "0 0 12px",
  fontFamily: "var(--font-mono)",
};

const bodyStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "var(--text-muted)",
  margin: "0 0 8px",
};

const preStyle: CSSProperties = {
  fontSize: 11,
  overflow: "auto",
  maxHeight: 200,
  background: "var(--tool-bg)",
  color: "var(--tool-fg)",
  border: "1px solid var(--tool-border)",
  fontFamily: "var(--font-mono)",
  padding: 12,
  borderRadius: 8,
};

const btnPrimary: CSSProperties = {
  marginTop: 16,
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--user-bg)",
  color: "var(--user-fg)",
  cursor: "pointer",
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  marginLeft: 8,
  background: "var(--bg-panel)",
  color: "var(--text)",
};
