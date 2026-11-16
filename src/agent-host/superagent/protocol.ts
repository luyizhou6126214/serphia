import { StringDecoder } from "node:string_decoder";
import type { SuperAgentReply } from "../../contract/superagent";
import { stopLocalAgent, type LocalAgentProcess } from "./process";

export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const replySchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "to", "question"],
  properties: {
    message: { type: "string" },
    to: { type: "array", items: { type: "string" } },
    question: { type: "string" },
  },
} as const;

export function parseReply(value: unknown): SuperAgentReply | null {
  const result = replyObject(value);
  if (
    typeof result.message !== "string" ||
    result.message.length > 32_000 ||
    typeof result.question !== "string" ||
    result.question.length > 4_000 ||
    !Array.isArray(result.to) ||
    result.to.length > 8 ||
    result.to.some((id) => typeof id !== "string" || id.length > 100) ||
    Object.keys(result).length !== 3
  )
    return null;
  return { message: result.message, question: result.question, to: [...new Set<string>(result.to)] };
}

export function replyObject(value: unknown): JsonObject {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, "$1"));
    } catch {
      return {};
    }
  }
  return object(value);
}

export function diagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : string(value);
  return message.replace(/(?:Bearer\s+|\b(?:sk|sk-ant|sess)-)[\w.-]{8,}/giu, "[redacted]").slice(0, 1_000);
}

export class JsonLinePeer {
  private sequence = 0;
  private buffer = "";
  private stderr = "";
  private error?: Error;
  private readonly decoder = new StringDecoder("utf8");
  private readonly requests = new Map<
    number,
    { resolve: (value: JsonObject) => void; reject: (error: Error) => void }
  >();
  private closing = false;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  onMessage: (message: JsonObject) => void = () => undefined;
  onFailure: (error: Error) => void = () => undefined;

  constructor(private readonly child: LocalAgentProcess) {
    this.ready = new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
      child.once("close", (code) => reject(new Error(`CLI closed before starting (${code ?? "signal"})`)));
    });
    child.stdout.on("data", (chunk: Buffer) => this.receive(this.decoder.write(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-1_600);
    });
    child.on("error", (error: Error) => this.fail(error));
    child.stdin.on("error", (error: Error) => this.fail(error));
    this.closed = new Promise((resolve) =>
      child.once("close", (code) => {
        this.fail(
          new Error(
            `CLI exited (${code ?? "signal"})${this.stderr.trim() ? `: ${diagnostic(this.stderr.trim())}` : ""}`,
          ),
        );
        resolve();
      }),
    );
  }

  private receive(text: string): void {
    if (this.error || this.closing) return;
    this.buffer += text;
    try {
      while (this.buffer.includes("\n")) {
        const newline = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        if (line.length > 4_194_304) throw new Error("CLI event exceeds the size limit");
        const message = object(JSON.parse(line));
        const pending = typeof message.id === "number" && !message.method ? this.requests.get(message.id) : undefined;
        if (pending) {
          this.requests.delete(message.id as number);
          if (message.error)
            pending.reject(new Error(string(object(message.error).message) || "CLI rejected the request"));
          else pending.resolve(object(message.result));
        } else {
          this.onMessage(message);
        }
      }
      if (this.buffer.length > 4_194_304) throw new Error("CLI event exceeds the size limit");
    } catch (error) {
      this.fail(error instanceof SyntaxError ? new Error("CLI returned invalid JSON on stdout") : (error as Error));
      stopLocalAgent(this.child, "SIGTERM");
    }
  }

  send(message: JsonObject): void {
    if (this.error) throw this.error;
    if (this.closing) throw new Error("CLI transport is closing");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: JsonObject): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.requests.set(id, { resolve, reject });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.requests.delete(id);
        reject(error);
      }
    });
  }

  private fail(error: Error): void {
    if (this.error) return;
    this.error = error;
    for (const pending of this.requests.values()) pending.reject(error);
    this.requests.clear();
    this.onFailure(error);
  }

  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = true;
      this.fail(new Error("CLI transport closed"));
      stopLocalAgent(this.child, "SIGTERM");
      const force = setTimeout(() => stopLocalAgent(this.child, "SIGKILL"), 2_000);
      void this.closed.finally(() => clearTimeout(force));
    }
    await this.closed;
  }
}
