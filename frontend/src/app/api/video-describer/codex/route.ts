import {
  type CodexSessionEvent,
  runCodexVideoTaskSession,
} from "@/lib/codex/run-video-task-session";

export const maxDuration = 300;
export const runtime = "nodejs";

interface CodexRequestPayload {
  userRequest?: unknown;
  videoTaskDescription?: unknown;
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = (await request.json()) as CodexRequestPayload;
    const userRequest = normalizeRequiredString(body.userRequest, "userRequest");
    const videoTaskDescription = normalizeRequiredString(
      body.videoTaskDescription,
      "videoTaskDescription",
    );

    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createStreamResponse({
        requestId,
        userRequest,
        videoTaskDescription,
      });
    }

    const result = await runCodexVideoTaskSession({
      userRequest,
      videoTaskDescription,
    });

    return Response.json(
      buildSuccessPayload(requestId, result),
      {
        headers: {
          "x-video-describer-codex-request-id": requestId,
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";

    return Response.json(
      { error: message },
      {
        status: isBadRequestError(message) ? 400 : 500,
        headers: {
          "x-video-describer-codex-request-id": requestId,
        },
      },
    );
  }
}

function createStreamResponse(input: {
  requestId: string;
  userRequest: string;
  videoTaskDescription: string;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      sendEvent({
        type: "status",
        message: "Starting Codex fulfillment session.",
      });

      try {
        const result = await runCodexVideoTaskSession({
          userRequest: input.userRequest,
          videoTaskDescription: input.videoTaskDescription,
          onEvent(event: CodexSessionEvent) {
            sendEvent({
              type: event.type,
              message: event.message,
            });
          },
        });

        sendEvent({
          type: "final",
          payload: buildSuccessPayload(input.requestId, result),
        });
      } catch (error) {
        sendEvent({
          type: "error",
          message:
            error instanceof Error ? error.message : "Unknown server error.",
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
      "x-video-describer-codex-request-id": input.requestId,
    },
  });
}

function buildSuccessPayload(
  requestId: string,
  result: Awaited<ReturnType<typeof runCodexVideoTaskSession>>,
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
