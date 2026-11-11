import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewFile } from "../../contract/code-review";
import { assertPathAllowed } from "../path-authorization";
import { toolchainRuntime } from "../toolchain-runtime";
import { isFilePathAllowed } from "../file-access-core";
import { ReviewError } from "./output";

const execute = promisify(execFile);
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const platformEnv = ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "SystemDrive", "SSL_CERT_FILE", "SSL_CERT_DIR"];

export function privateEnvironment(home: string) {
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    NoDefaultCurrentDirectoryInExePath: "1",
    OCR_ENABLE_TELEMETRY: "0",
    OCR_RAW_LOGGING: "0",
    TERM: "dumb",
  };
  for (const key of platformEnv) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export async function resolveWorkspace(cwd: unknown, home: string, signal: AbortSignal, requireGit = true) {
  if (typeof cwd !== "string" || cwd.length > 4096 || !path.isAbsolute(cwd) || /[\0\r\n]/u.test(cwd)) {
    throw new ReviewError("notRepository");
  }
  let directory: string;
  try {
    directory = await realpath(cwd);
    await assertPathAllowed(directory);
    if (!(await stat(directory)).isDirectory()) throw new Error();
  } catch {
    throw new ReviewError("notRepository");
  }
  const resolution = await toolchainRuntime.prepare(directory, "git-operation");
  const descriptor = resolution.commands["vcs.git"];
  if (!descriptor) throw new ReviewError("gitMissing");

  const env = {
    ...privateEnvironment(home),
    PATH: [
      path.dirname(descriptor.executable),
      ...(descriptor.pathEntries ?? []),
      ...(process.platform === "win32"
        ? [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
        : ["/usr/bin", "/bin"]),
    ]
      .filter(path.isAbsolute)
      .join(path.delimiter),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
  };
  const expectedName = process.platform === "win32" ? "git.exe" : "git";
  // OCR resolves Git by name. Do not silently review with a different binary.
  let git: string;
  try {
    git = await realpath(path.join(path.dirname(descriptor.executable), expectedName));
    if (git !== (await realpath(descriptor.executable)) || descriptor.argvPrefix.length) throw new Error();
  } catch {
    throw new ReviewError("gitMissing");
  }
  const runGit = async (args: string[], root = directory) => {
    try {
      return (
        await execute(git, args, {
          cwd: root,
          env,
          signal,
          timeout: 12_000,
          maxBuffer: MAX_INPUT_BYTES,
          encoding: "buffer",
          windowsHide: true,
        })
      ).stdout;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new ReviewError("scopeLimit");
      }
      throw error;
    }
  };
  const version = await runGit(["--version"]).catch(() => {
    throw new ReviewError("gitMissing");
  });
  const parsed = /git version (\d+)\.(\d+)\.(\d+)/u.exec(version.toString("utf8"));
  if (!parsed) throw new ReviewError("gitMissing");
  if (Number(parsed[1]) < 2 || (parsed[1] === "2" && Number(parsed[2]) < 41)) throw new ReviewError("gitOld");

  let root: string;
  try {
    root = await realpath((await runGit(["rev-parse", "--show-toplevel"])).toString("utf8").replace(/\r?\n$/u, ""));
  } catch {
    if (requireGit) throw new ReviewError("notRepository");
    root = directory;
  }
  await assertPathAllowed(root);
  return { root, env, git: (args: string[]) => runGit(args, root) };
}

export async function resolveReviewFile(root: string, relative: string) {
  const candidate = path.resolve(root, relative);
  if (!isFilePathAllowed(candidate, new Set([root]))) throw new ReviewError("notRepository");
  const file = await realpath(candidate);
  if (!isFilePathAllowed(file, new Set([root])) || !(await lstat(file)).isFile())
    throw new ReviewError("notRepository");
  return file;
}

export async function fingerprint(
  workspace: Awaited<ReturnType<typeof resolveWorkspace>>,
  files: ReviewFile[],
  signal: AbortSignal,
  includeGit = true,
) {
  const head = includeGit
    ? await workspace.git(["rev-parse", "--verify", "HEAD"]).catch((error: unknown) => {
        if ((error as { code?: unknown }).code === 128) return Buffer.alloc(0);
        throw error;
      })
    : Buffer.alloc(0);
  const hash = createHash("sha256").update(head);
  const diff = ["diff", "--no-ext-diff", "--no-textconv", "--binary"];
  let bytes = 0;
  for (const args of includeGit
    ? [
        [...diff, "--cached", "--"],
        [...diff, "--"],
        ["ls-files", "--others", "--exclude-standard", "-z"],
      ]
    : []) {
    const output = await workspace.git(args);
    bytes += output.length;
    if (bytes > MAX_INPUT_BYTES) throw new ReviewError("scopeLimit");
    hash.update(String(output.length)).update(":").update(output);
  }
  // Hash the working copies too. An unstaged and a staged edit can cancel
  // each other in HEAD's diff, and untracked paths have no patch in Git.
  for (const entry of files) {
    if (!entry.included) continue;
    signal.throwIfAborted();
    const file = await resolveReviewFile(workspace.root, entry.path);
    const contentHash = createHash("sha256");
    for await (const chunk of createReadStream(file, { signal })) {
      bytes += chunk.length;
      if (bytes > MAX_INPUT_BYTES) throw new ReviewError("scopeLimit");
      contentHash.update(chunk);
    }
    hash.update(JSON.stringify([entry.path, contentHash.digest("hex")]));
  }
  return hash.digest("hex");
}
