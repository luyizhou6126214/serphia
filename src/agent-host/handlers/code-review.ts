import type { ReviewReply } from "../../contract/code-review";
import type { ApiHandler } from "../../contract/rpc";
import { ReviewError } from "../code-review/output";
import type { CodeReviewService } from "../code-review/service";

type ReviewMethods = Extract<keyof ApiHandler, `codeReview.${string}`>;

async function reply<T>(operation: () => Promise<T>): Promise<ReviewReply<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return {
      ok: false,
      issue:
        error instanceof ReviewError
          ? error.issue
          : error instanceof Error && error.name === "TimeoutError"
            ? "timeout"
            : "failed",
    };
  }
}

export function createCodeReviewHandlers(service: CodeReviewService) {
  return {
    "codeReview.preview": (params) => reply(() => service.preview(params)),
    "codeReview.branches": (params) => reply(() => service.branches(params?.cwd)),
    "codeReview.config.get": () => reply(() => service.getConfig()),
    "codeReview.config.status": () => reply(() => service.modelStatus()),
    "codeReview.config.save": (params) => reply(() => service.saveConfig(params)),
    "codeReview.mcp.get": () => reply(() => service.getMcp()),
    "codeReview.mcp.save": (params) => reply(() => service.saveMcp(params)),
    "codeReview.start": (params) => reply(() => service.start(params?.previewId, params?.model)),
    "codeReview.getRun": (params) => service.getRun(params?.id),
    "codeReview.activity": (params) => service.activity(params?.id, params?.after),
    "codeReview.history.list": (params) => reply(() => service.listHistory(params?.cwd, params?.limit, params?.offset)),
    "codeReview.history.open": (params) => reply(() => service.openHistory(params)),
    "codeReview.history.diff": (params) => reply(() => service.historyDiff(params?.ref, params?.path)),
    "codeReview.history.activity": (params) => reply(() => service.historyActivity(params?.ref, params?.after)),
    "codeReview.cancel": (params) => service.cancel(params?.id),
    "codeReview.locateFinding": (params) => reply(() => service.locateFinding(params?.id, params?.findingId)),
    "codeReview.diff": (params) => reply(() => service.diff(params)),
    "codeReview.command": (params) => reply(() => service.command(params)),
    "codeReview.testModel": (params) => reply(() => service.testModel(params?.cwd, params?.model)),
  } satisfies Required<Pick<ApiHandler, ReviewMethods>>;
}
