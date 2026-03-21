import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";

import { VIDEO_TO_DETAILED_DESCRIPTION_PROMPT } from "@/lib/gemini/prompts/video-to-detailed-description";

export const maxDuration = 60;
export const runtime = "nodejs";
const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

export async function POST(request: Request) {
  const requestId = createRequestId();
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    console.error(`[video-describer:${requestId}] Missing Gemini API key`);
    return Response.json(
      {
        error:
          "Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.",
      },
      {
        status: 500,
        headers: { "x-video-describer-request-id": requestId },
      },
    );
  }

  try {
    console.info(`[video-describer:${requestId}] Received POST request`);
    const formData = await request.formData();
    const instructions = formData.get("instructions");
    const video = formData.get("video");
    const prompt =
      typeof instructions === "string" && instructions.trim().length > 0
        ? instructions.trim()
        : "No additional user instructions were provided.";

    if (!(video instanceof File)) {
      console.warn(`[video-describer:${requestId}] No file received`);
      return Response.json(
        { error: "A video upload is required." },
        {
          status: 400,
          headers: { "x-video-describer-request-id": requestId },
        },
      );
    }

    const videoMimeType = getSupportedVideoMimeType(video);
    console.info(
      `[video-describer:${requestId}] File metadata`,
      JSON.stringify({
        name: video.name,
        mimeType: videoMimeType || video.type || "unknown",
        sizeBytes: video.size,
        instructionLength: prompt.length,
      }),
    );

    if (!videoMimeType) {
      console.warn(
        `[video-describer:${requestId}] Unsupported mime type: ${video.type || "unknown"}`,
      );
      return Response.json(
        { error: "Only video/mp4 and video/webm are supported on this page." },
        {
          status: 400,
          headers: { "x-video-describer-request-id": requestId },
        },
      );
    }

    const google = createGoogleGenerativeAI({ apiKey });
    const videoBytes = new Uint8Array(await video.arrayBuffer());
    console.info(
      `[video-describer:${requestId}] Starting Gemini stream with ${videoBytes.byteLength} bytes`,
    );

    const result = streamText({
      model: google("gemini-2.5-pro"),
      system: VIDEO_TO_DETAILED_DESCRIPTION_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildPrompt(prompt, video.name),
            },
            {
              type: "file",
              data: videoBytes,
              mediaType: videoMimeType,
            },
          ],
        },
      ],
      temperature: 0.2,
      onFinish({ text, finishReason, usage }) {
        console.info(
          `[video-describer:${requestId}] Gemini stream finished`,
          JSON.stringify({
            finishReason,
            outputChars: text.length,
            usage,
          }),
        );
      },
    });

    return result.toTextStreamResponse({
      headers: {
        "x-video-describer-request-id": requestId,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";
    console.error(`[video-describer:${requestId}] Route failed`, error);

    return Response.json(
      { error: message },
      {
        status: 500,
        headers: { "x-video-describer-request-id": requestId },
      },
    );
  }
}

function buildPrompt(prompt: string, videoFilename?: string): string {
  return [
    "User instructions:",
    prompt,
    "",
    `Uploaded video filename: ${videoFilename || "unknown.mp4"}`,
    "",
    "Analyze the uploaded recording and produce the requested detailed description.",
  ].join("\n");
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getSupportedVideoMimeType(video: File): string | null {
  const mimeType = video.type.split(";")[0]?.trim().toLowerCase();

  if (mimeType && SUPPORTED_VIDEO_MIME_TYPES.has(mimeType)) {
    return mimeType;
  }

  const normalizedName = video.name.toLowerCase();

  if (normalizedName.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (normalizedName.endsWith(".webm")) {
    return "video/webm";
  }

  return null;
}
