import { stringifyCompactJson } from "@/lib/json-io";
import { findRepoRoot } from "@/services/repo-paths";
import {
  streamSuiteOutput,
  suiteDefinition,
  validateSuiteId,
  type SuiteId,
} from "@/services/maintenance-test-run";
import { createRunRecordId, saveRunRecord } from "@/services/maintenance-runs";

type TestRunRequestBody = {
  suite?: string;
};

function formatSseData(payload: unknown): string {
  return `data: ${stringifyCompactJson(payload)}\n\n`;
}

function formatSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${stringifyCompactJson(payload)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  let body: TestRunRequestBody;
  try {
    body = (await request.json()) as TestRunRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const suite = body.suite?.trim() ?? "";
  const validation = validateSuiteId(suite);
  if (validation !== null) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const suiteId = suite as SuiteId;
  const definition = suiteDefinition(suiteId);
  const recordId = createRunRecordId();
  const startedAt = new Date().toISOString();
  const repoRoot = findRepoRoot();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let exitCode = 0;
      try {
        for await (const chunk of streamSuiteOutput(suiteId, repoRoot)) {
          if (chunk.type === "exit") {
            exitCode = chunk.exitCode;
            controller.enqueue(encoder.encode(formatSseEvent("exit", { exitCode: chunk.exitCode })));
          } else {
            controller.enqueue(
              encoder.encode(formatSseData({ stream: chunk.type, line: chunk.line })),
            );
          }
        }
      } catch (error) {
        exitCode = 1;
        const message = error instanceof Error ? error.message : "Test run failed";
        controller.enqueue(encoder.encode(formatSseData({ stream: "stderr", line: message })));
        controller.enqueue(encoder.encode(formatSseEvent("exit", { exitCode: 1 })));
      } finally {
        saveRunRecord({
          id: recordId,
          suite: suiteId,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          command: definition.command,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
