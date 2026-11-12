import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api-client";
import type { ReviewIssue, ReviewModelSelection, ReviewPreview, ReviewRequest, ReviewRun } from "@contract/code-review";

export function reviewIsActive(run: ReviewRun | null) {
  return run?.state === "running" || run?.state === "cancelling";
}

export function useCodeReview(request: ReviewRequest | null) {
  const key = JSON.stringify(request);
  const [preview, setPreview] = useState<{ key: string; value: ReviewPreview } | null>(null);
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [busy, setBusy] = useState<"preview" | "start" | null>(null);
  const [issue, setIssue] = useState<ReviewIssue | null>(null);
  const pending = useRef(false);
  const active = reviewIsActive(run);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const latest = await call("codeReview.getRun", {});
        if (!disposed) {
          setRun(latest);
          if (reviewIsActive(latest)) timer = setTimeout(() => void refresh(), 900);
        }
      } catch {
        if (!disposed) timer = setTimeout(() => void refresh(), 1500);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active]);

  const currentPreview = preview?.key === key ? preview.value : null;
  const previewChanges = useCallback(async () => {
    if (!request || pending.current || active) return;
    pending.current = true;
    setBusy("preview");
    setIssue(null);
    setPreview(null);
    try {
      const result = await call("codeReview.preview", request);
      if (result.ok) setPreview({ key, value: result.value });
      else setIssue(result.issue);
    } catch {
      setIssue("failed");
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }, [request, key, active]);

  async function start(model: ReviewModelSelection) {
    if (!request || pending.current || active) return;
    pending.current = true;
    setBusy("start");
    setIssue(null);
    try {
      let selectedPreview = currentPreview;
      if (!selectedPreview) {
        const next = await call("codeReview.preview", request);
        if (!next.ok) {
          setIssue(next.issue);
          return;
        }
        selectedPreview = next.value;
        if (!selectedPreview.files.some((file) => file.included)) {
          setPreview({ key, value: selectedPreview });
          return;
        }
      }
      const result = await call("codeReview.start", { previewId: selectedPreview.id, model });
      if (result.ok) {
        setRun(result.value);
        setPreview(null);
      } else {
        if (result.issue === "stalePreview") setPreview(null);
        setIssue(result.issue);
      }
    } catch {
      setIssue("failed");
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function cancel() {
    if (run?.state !== "running") return;
    try {
      const updated = await call("codeReview.cancel", { id: run.id });
      if (updated) setRun(updated);
    } catch {
      setIssue("failed");
    }
  }
  return { preview: currentPreview, run, active, busy, issue, setIssue, previewChanges, start, cancel };
}
