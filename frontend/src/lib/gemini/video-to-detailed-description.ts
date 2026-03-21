import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
} from '@google/genai';

import { VIDEO_TO_DETAILED_DESCRIPTION_PROMPT } from '@/lib/gemini/prompts/video-to-detailed-description';

const DEFAULT_MODEL = 'gemini-2.5-pro';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLLS = 120;

type VideoInput = Blob | string;

export interface GenerateDetailedDescriptionInput {
  video: VideoInput;
  userInstructions?: string;
  apiKey?: string;
  mimeType?: string;
  model?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  deleteUploadedFile?: boolean;
  onChunk?: (chunk: string) => void | Promise<void>;
}

export interface GenerateDetailedDescriptionResult {
  detailedDescription: string;
  uploadedFile: {
    name?: string;
    uri?: string;
    mimeType?: string;
  };
}

interface GeminiFileHandle {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: unknown;
}

// Server-side helper. Do not expose your Gemini API key in client-side code.
export async function generateDetailedDescriptionFromVideo(
  input: GenerateDetailedDescriptionInput,
): Promise<GenerateDetailedDescriptionResult> {
  const apiKey =
    input.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY before calling generateDetailedDescriptionFromVideo().',
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  let uploadedFile = (await ai.files.upload({
    file: input.video,
    config: {
      mimeType: input.mimeType ?? inferMimeType(input.video),
    },
  })) as GeminiFileHandle;

  try {
    uploadedFile = await waitForFileToBecomeActive(ai, uploadedFile, {
      pollIntervalMs: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      maxPolls: input.maxPolls ?? DEFAULT_MAX_POLLS,
    });

    if (!uploadedFile.uri || !uploadedFile.mimeType) {
      throw new Error(
        'Gemini returned an uploaded file without a usable uri or mimeType.',
      );
    }

    const response = await ai.models.generateContentStream({
      model: input.model ?? DEFAULT_MODEL,
      config: {
        systemInstruction: VIDEO_TO_DETAILED_DESCRIPTION_PROMPT,
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
        temperature: 0.2,
      },
      contents: createUserContent([
        buildIntentMessage(input.userInstructions),
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      ]),
    });

    let detailedDescription = '';

    for await (const chunk of response) {
      const text = chunk.text ?? '';

      if (!text) {
        continue;
      }

      detailedDescription += text;
      await input.onChunk?.(text);
    }

    return {
      detailedDescription: detailedDescription.trim(),
      uploadedFile: {
        name: uploadedFile.name,
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType,
      },
    };
  } finally {
    if (input.deleteUploadedFile !== false && uploadedFile.name) {
      await ai.files.delete({ name: uploadedFile.name }).catch(() => undefined);
    }
  }
}

async function waitForFileToBecomeActive(
  ai: GoogleGenAI,
  initialFile: GeminiFileHandle,
  options: {
    pollIntervalMs: number;
    maxPolls: number;
  },
): Promise<GeminiFileHandle> {
  if (!initialFile.name) {
    throw new Error('Gemini file upload did not return a file name.');
  }

  let currentFile = initialFile;

  for (let attempt = 0; attempt < options.maxPolls; attempt += 1) {
    const fileState = normalizeFileState(currentFile.state);

    if (fileState.endsWith('ACTIVE')) {
      return currentFile;
    }

    if (fileState.endsWith('FAILED')) {
      throw new Error(
        `Gemini failed to process uploaded video "${initialFile.name}".`,
      );
    }

    await sleep(options.pollIntervalMs);
    currentFile = (await ai.files.get({
      name: initialFile.name,
    })) as GeminiFileHandle;
  }

  throw new Error(
    `Timed out while waiting for Gemini to finish processing "${initialFile.name}".`,
  );
}

function buildIntentMessage(userInstructions?: string): string {
  const trimmedInstructions = userInstructions?.trim();

  if (!trimmedInstructions) {
    return [
      'User instructions:',
      'No extra instructions were provided.',
      'Infer the likely intent from the video and label uncertain conclusions with "Inference:".',
    ].join('\n');
  }

  return ['User instructions:', trimmedInstructions].join('\n');
}

function inferMimeType(video: VideoInput): string | undefined {
  if (typeof video !== 'string') {
    return video.type || undefined;
  }

  const normalizedPath = video.toLowerCase();

  if (normalizedPath.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (normalizedPath.endsWith('.webm')) {
    return 'video/webm';
  }

  if (normalizedPath.endsWith('.mov')) {
    return 'video/quicktime';
  }

  return undefined;
}

function normalizeFileState(state: unknown): string {
  if (!state) {
    return 'PROCESSING';
  }

  if (typeof state === 'string') {
    return state.toUpperCase();
  }

  if (typeof state === 'object' && state !== null && 'name' in state) {
    const name = (state as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) {
      return name.toUpperCase();
    }
  }

  return String(state).toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
