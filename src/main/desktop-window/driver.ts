import { execFile } from "node:child_process";
import path from "node:path";

export type DriverWindow = {
  id: string;
  pid: number;
  process_instance: string;
  app_name: string;
  title: string;
  is_focused: boolean;
  visible: boolean;
  minimized: boolean;
  accessible: boolean;
};

type DriverReply<T> = { ok: true; data: T } | { ok: false; error: { code: string } };

export class AgentDesktopDriver {
  constructor(private readonly executable: string) {}

  windows(home: string, signal: AbortSignal): Promise<DriverWindow[]> {
    return this.run(["list-windows", "--timeout-ms", "1000"], home, signal, undefined, 2000);
  }

  focusWindow(id: string, home: string, signal: AbortSignal): Promise<unknown> {
    return this.run(["focus-window", "--headed", "--window-id", id], home, signal);
  }

  run<T>(args: string[], home: string, signal: AbortSignal, stdin?: string, timeout = 6500): Promise<T> {
    signal.throwIfAborted();
    if (!path.isAbsolute(this.executable) || path.extname(this.executable).toLowerCase() !== ".exe")
      throw new Error("The bundled agent-desktop executable path is invalid");
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_DESKTOP_HOME: home };
    delete env.AGENT_DESKTOP_SESSION;
    delete env.AGENT_DESKTOP_AGENT_ID;
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.executable,
        args,
        { env, signal, timeout, windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
        (error, stdout) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          try {
            const reply = JSON.parse(stdout) as DriverReply<T>;
            if (!reply.ok) throw new Error(`agent-desktop: ${args[0]} returned ${reply.error.code}`);
            if (error) throw error;
            resolve(reply.data);
          } catch (cause) {
            const message =
              cause instanceof Error && cause.message.startsWith("agent-desktop: ")
                ? cause.message
                : `agent-desktop did not complete ${args[0]}`;
            reject(new Error(message));
          }
        },
      );
      // A stopped driver may close the pipe before it finishes reading text.
      child.stdin?.on("error", () => {});
      child.stdin?.end(stdin);
    });
  }
}
