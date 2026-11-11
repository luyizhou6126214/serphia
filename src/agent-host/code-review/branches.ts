import type { ReviewBranches } from "../../contract/code-review";
import type { Workspace } from "./scope";

export async function listReviewBranches(workspace: Workspace): Promise<ReviewBranches> {
  const [output, currentOutput] = await Promise.all([
    workspace.git([
      "for-each-ref",
      "--format=%(refname)%00%(symref)",
      "refs/heads",
      "refs/remotes",
      "refs/pull",
      "refs/merge-requests",
    ]),
    workspace.git(["symbolic-ref", "--quiet", "HEAD"]).catch(() => null),
  ]);
  const current = currentOutput?.toString("utf8").trim() || null;
  const defaults: { ref: string; target: string }[] = [];
  const refs: ReviewBranches["refs"] = [];
  for (const line of output.toString("utf8").split("\n")) {
    const [ref, target] = line.split("\0");
    if (!ref) continue;
    if (target) {
      if (ref.startsWith("refs/remotes/") && ref.endsWith("/HEAD")) defaults.push({ ref, target });
      continue;
    }
    if (ref.startsWith("refs/heads/")) refs.push({ ref, label: ref.slice(11), kind: "local" });
    else if (ref.startsWith("refs/remotes/")) refs.push({ ref, label: ref.slice(13), kind: "remote" });
    else refs.push({ ref, label: ref.slice(5), kind: "pull" });
  }
  const known = new Set(refs.map(({ ref }) => ref));
  const remoteBase = defaults.find(({ ref }) => ref === "refs/remotes/origin/HEAD") ?? defaults[0];
  const base =
    [
      remoteBase?.target,
      "refs/heads/main",
      "refs/heads/master",
      "refs/heads/trunk",
      "refs/remotes/origin/main",
      "refs/remotes/origin/master",
      ...refs.map(({ ref }) => ref),
    ].find((ref) => ref && known.has(ref)) ?? current;
  return { current, base, refs };
}
