import type { HerdrConversation, HerdrConversationMessage } from "../../contract/herdr";

const MAX_MESSAGES = 80;
const MAX_CHARS = 128 * 1024;

// pi can report idle before its startup trust picker has been answered. Match
// the active picker footer, so an old question in scrollback won't block a turn.
export function piNeedsChoice(screen: string) {
  const tail = screen.slice(-4096);
  return (
    /^\s*Trust project folder\?\s*$/im.test(tail) &&
    /↑↓\s+navigate\s+enter\s+select\s+escape\/ctrl\+c\s+cancel[\s─━]*$/iu.test(tail)
  );
}

// Herdr returns a rolling, ANSI-stripped screen. Only include text changed since this
// prompt, excluding the echoed input. Unstructured replies remain labelled as pane output.
export function replySincePrompt(before: string, after: string, prompt: string) {
  const old = before.trimEnd().split("\n");
  const next = after.trimEnd().split("\n");
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = next.length;
  let previous = old.length;
  while (end > start && previous > start && next[end - 1] === old[previous - 1]) {
    end--;
    previous--;
  }
  if (start === 0 && before && end === next.length) {
    // Handle scrollback rollover when there is no longer a shared first line.
    for (let i = Math.max(0, old.length - next.length); i < old.length; i++) {
      if (old[i] === next[0] && old.slice(i).every((line, n) => line === next[n])) {
        start = old.length - i;
        break;
      }
    }
  }
  let changed = next.slice(start, end).join("\n").trim();
  const input = prompt.trim();
  for (const prefix of ["", "> ", "› ", "❯ "]) {
    const echo = prefix + input;
    if (changed === echo) return "";
    if (changed.startsWith(echo + "\n")) {
      changed = changed.slice(echo.length).trimStart();
      break;
    }
  }
  return changed;
}

export class PaneChat {
  private history: HerdrConversationMessage[] = [];
  private truncated = false;
  private turn?: { prompt: string; baseline: string; nativeMatches: number; nativeTail?: string };

  accept(prompt: string, screen: string, native: HerdrConversation | null) {
    const previous = this.snapshot(screen, native);
    this.history = previous.messages;
    this.truncated = previous.truncated;
    this.turn = {
      prompt,
      baseline: screen,
      nativeMatches: native?.messages.filter((m) => m.role === "user" && m.text.trim() === prompt.trim()).length ?? 0,
      nativeTail: native ? JSON.stringify(native.messages.slice(-2)) : undefined,
    };
  }

  snapshot(screen: string, native: HerdrConversation | null): HerdrConversation {
    if (!this.turn) return native ?? { messages: [], truncated: false };
    const { prompt, baseline, nativeMatches, nativeTail } = this.turn;
    if (native && JSON.stringify(native.messages.slice(-2)) !== nativeTail) {
      const users = native.messages.filter((m) => m.role === "user");
      const matches = users.filter((m) => m.text.trim() === prompt.trim()).length;
      if (matches > nativeMatches || (native.truncated && users.at(-1)?.text.trim() === prompt.trim())) return native;
    }
    const messages = [...this.history, { role: "user" as const, text: prompt }];
    const reply = replySincePrompt(baseline, screen, prompt);
    if (reply) messages.push({ role: "assistant", text: reply, source: "pane" });
    let chars = 0;
    let first = messages.length;
    while (first > 0 && messages.length - first < MAX_MESSAGES) {
      const size = messages[first - 1].text.length;
      if (chars && chars + size > MAX_CHARS) break;
      chars += size;
      first--;
    }
    return { messages: messages.slice(first), truncated: first > 0 || (native?.truncated ?? this.truncated) };
  }
}
