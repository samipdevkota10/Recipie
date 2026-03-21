import {
  runCodexRequestTaskSession,
  type CodexSessionEvent,
} from "@/lib/codex/run-request-task-session";

export const maxDuration = 300;
export const runtime = "nodejs";

interface AgentRequestPayload {
  prompt?: unknown;
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = (await request.json()) as AgentRequestPayload;
    const prompt = normalizeRequiredString(body.prompt, "prompt");

    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createStreamResponse({ prompt, requestId });
    }

    const result = await runCodexRequestTaskSession({
      userRequest: prompt,
    });

    return Response.json(buildSuccessPayload(requestId, result), {
      headers: {
        "x-run-agent-request-id": requestId,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";

    return Response.json(
      { error: message },
      {
        status: isBadRequestError(message) ? 400 : 500,
        headers: {
          "x-run-agent-request-id": requestId,
        },
      },
    );
  }
}

function createStreamResponse(input: { prompt: string; requestId: string }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      sendEvent({
        type: "system",
        text: "Starting artifact session.",
      });

      try {
        const result = await runCodexRequestTaskSession({
          userRequest: input.prompt,
          onEvent(event: CodexSessionEvent) {
            sendEvent(mapCodexEventToStream(event));
          },
        });

        sendEvent({
          type: "final",
          payload: buildSuccessPayload(input.requestId, result),
        });
        sendEvent({
          type: "done",
          text: `Artifact ready: ${result.artifact.filename}`,
        });
      } catch (error) {
        sendEvent({
          type: "error",
          text: error instanceof Error ? error.message : "Unknown server error.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-run-agent-request-id": input.requestId,
    },
  });
}

function buildSuccessPayload(
  requestId: string,
  result: Awaited<ReturnType<typeof runCodexRequestTaskSession>>,
) {
  return {
    requestId,
    sessionId: result.sessionId,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    summary: result.summary,
    artifact: {
      filename: result.artifact.filename,
      mediaType: result.artifact.mediaType,
      sizeBytes: result.artifact.bytes.byteLength,
      contentBase64: Buffer.from(result.artifact.bytes).toString("base64"),
    },
  };
}

function mapCodexEventToStream(event: CodexSessionEvent): {
  type: string;
  text: string;
} {
  if (event.type === "warning") {
    return {
      type: "stderr",
      text: event.message,
    };
  }

  if (event.type === "status") {
    return {
      type: "system",
      text: event.message,
    };
  }

  return {
    type: "stdout",
    text: event.message,
  };
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Request field "${fieldName}" must be a non-empty string.`);
  }

  return value.trim();
}

function isBadRequestError(message: string): boolean {
  return message.startsWith('Request field "');
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
