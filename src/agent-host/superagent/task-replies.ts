import type { SuperAgentAssignment, SuperAgentTaskRun } from "../../contract/superagent";
import { object, replyObject } from "./protocol";

const text = { type: "string" };
function schema(properties: Record<string, unknown>) {
  return { type: "object", properties, additionalProperties: false, required: Object.keys(properties) };
}

export const taskReplySchemas = {
  plan: schema({
    assignments: { type: "array", items: schema({ memberId: text, description: text, criteria: text }) },
    question: text,
  }),
  work: schema({ report: text, tests: text, blocker: text, question: text }),
  summary: schema({ report: text, question: text }),
};

const replyExamples = {
  plan: '{"assignments":[{"memberId":"exact roster ID","description":"independent work","criteria":"acceptance criteria"}],"question":""}',
  work: '{"report":"delivered work","tests":"tests and results, or why none ran","blocker":"","question":""}',
  summary: '{"report":"results, test evidence and remaining concerns","question":""}',
};

export function taskReplyInstructions(kind: SuperAgentTaskRun["kind"]): string {
  return `Return exactly one JSON object with this shape: ${replyExamples[kind]}
Leave question empty unless you need input from the user. When asking a question as the planner, return an empty assignments array. When unable to deliver as a worker, describe the blocker or ask a question, but use only one of those fields.`;
}

function field(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) {
    throw new Error("Invalid structured task reply");
  }
  return value.trim();
}

export type TaskReply =
  | { kind: "question"; question: string; report?: string; tests?: string }
  | { kind: "plan"; assignments: SuperAgentAssignment[] }
  | { kind: "work"; report: string; tests: string; blocker: string }
  | { kind: "summary"; report: string };

export function parseTaskReply(kind: SuperAgentTaskRun["kind"], raw: unknown): TaskReply {
  const reply = replyObject(raw);
  const keys = taskReplySchemas[kind].required;
  if (Object.keys(reply).length !== keys.length || !keys.every((key) => Object.hasOwn(reply, key))) {
    throw new Error("Invalid structured task reply");
  }
  const question = field(reply.question, 4_000);
  if (kind === "plan") {
    if (
      !Array.isArray(reply.assignments) ||
      reply.assignments.length > 7 ||
      Boolean(reply.assignments.length) === Boolean(question)
    ) {
      throw new Error("Return either assignments or a question");
    }
    if (question) return { kind: "question", question };
    const assignments = reply.assignments.map((value) => {
      const item = object(value);
      const memberId = field(item.memberId, 100);
      const description = field(item.description, 4_000);
      const criteria = field(item.criteria, 4_000);
      if (Object.keys(item).length !== 3 || !memberId || !description || !criteria) {
        throw new Error("Each assignment requires a member, description and criteria");
      }
      return { memberId, description, criteria };
    });
    return { kind, assignments };
  }
  const report = field(reply.report, 16_000);
  if (kind === "summary") {
    if (question) return { kind: "question", question, report };
    if (!report) throw new Error("The leader returned an empty summary");
    return { kind, report };
  }
  const tests = field(reply.tests, 8_000);
  const blocker = field(reply.blocker, 4_000);
  if (question && blocker) throw new Error("Return either a question or a blocker");
  if (question) return { kind: "question", question, report, tests };
  if (!blocker && (!report || !tests)) throw new Error("A delivery requires a report and test results");
  return { kind, report, tests, blocker };
}
