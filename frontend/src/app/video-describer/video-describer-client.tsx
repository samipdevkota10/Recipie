"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface DebugEntry {
  id: string;
  message: string;
  timestamp: string;
}

const SUPPORTED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
const VIDEO_UPLOAD_ACCEPT = SUPPORTED_VIDEO_MIME_TYPES.join(",");
const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function VideoDescriberClient() {
  const [instructions, setInstructions] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [completion, setCompletion] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [canRecordVideo, setCanRecordVideo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);

  useEffect(() => {
    setCanRecordVideo(
      typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function",
    );

    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        discardRecordingRef.current = true;
        mediaRecorderRef.current.stop();
      }

      stopMediaStream(mediaStreamRef.current);

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      abortControllerRef.current?.abort();
    };
  }, []);

  function addDebugLog(message: string) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      timestamp: new Date().toLocaleTimeString(),
    };

    console.debug(`[video-describer-ui] ${message}`);
    setDebugEntries((current) => [...current, entry]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading || isRecording) {
      return;
    }

    if (!selectedVideo) {
      setClientError("Select or record a video before submitting.");
      addDebugLog("Submit blocked: no video selected.");
      return;
    }

    const videoMimeType = getSupportedVideoMimeType(selectedVideo);

    if (!videoMimeType) {
      setClientError("Only mp4 and webm uploads are supported on this page.");
      addDebugLog(
        `Submit blocked: unsupported file type ${selectedVideo.type || "unknown"}.`,
      );
      return;
    }

    await submitVideo(selectedVideo, videoMimeType);
  }

  async function submitVideo(videoFile: File, videoMimeType: string) {
    setClientError(null);
    setCompletion("");
    setIsLoading(true);
    addDebugLog(
      `Submitting ${videoFile.name} (${formatMegabytes(videoFile.size)}) with ${instructions.trim().length} instruction chars.`,
    );

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const formData = new FormData();
      formData.set(
        "instructions",
        instructions.trim() || "No additional user instructions were provided.",
      );
      formData.set(
        "video",
        new File([videoFile], videoFile.name, { type: videoMimeType }),
      );

      const response = await fetch("/api/video-describer", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const requestId =
        response.headers.get("x-video-describer-request-id") || "missing";
      addDebugLog(
        `Received HTTP ${response.status} from /api/video-describer (request id: ${requestId}).`,
      );

      if (!response.ok) {
        const payload = (await safeParseJson(response)) as { error?: string };
        throw new Error(payload.error || "Video description request failed.");
      }

      if (!response.body) {
        throw new Error("The server returned no response body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        chunkCount += 1;
        fullText += decoder.decode(value, { stream: true });
        setCompletion(fullText);

        if (chunkCount <= 3 || chunkCount % 10 === 0) {
          addDebugLog(
            `Stream chunk ${chunkCount} received (${value.byteLength} bytes, ${fullText.length} chars total).`,
          );
        }
      }

      fullText += decoder.decode();
      setCompletion(fullText);
      addDebugLog(
        `Streaming finished after ${chunkCount} chunks with ${fullText.length} output chars.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        addDebugLog("Request aborted by user.");
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unknown client error.";
      setClientError(message);
      addDebugLog(`Request failed: ${message}`);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }

  function handleClear() {
    abortControllerRef.current?.abort();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      discardRecordingRef.current = true;
      mediaRecorderRef.current.stop();
    }

    stopMediaStream(mediaStreamRef.current);
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    discardRecordingRef.current = false;
    addDebugLog("Cleared current video, output, and client state.");
    setInstructions("");
    setSelectedVideoFile(null);
    setClientError(null);
    setCompletion("");
    setIsLoading(false);
    setIsRecording(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleRecordVideo() {
    if (isLoading) {
      return;
    }

    if (isRecording) {
      discardRecordingRef.current = false;
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!canRecordVideo) {
      setClientError("Screen recording is not available in this browser.");
      addDebugLog("Recording blocked: browser does not support screen capture.");
      return;
    }

    try {
      setClientError(null);
      discardRecordingRef.current = false;
      recordedChunksRef.current = [];

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const mimeType = getPreferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener("ended", () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setIsRecording(false);
        setClientError("Screen recording failed before the file could be saved.");
        addDebugLog("Recording failed: MediaRecorder emitted an error event.");
      };

      recorder.onstop = () => {
        const shouldDiscard = discardRecordingRef.current;
        const recordedChunks = [...recordedChunksRef.current];
        const recordedMimeType =
          getSupportedMimeType(recorder.mimeType) ?? "video/webm";

        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        discardRecordingRef.current = false;
        setIsRecording(false);

        if (shouldDiscard) {
          addDebugLog("Discarded in-progress recording.");
          return;
        }

        if (recordedChunks.length === 0) {
          setClientError("Recording finished, but no video data was captured.");
          addDebugLog("Recording stopped without any captured video data.");
          return;
        }

        const extension = recordedMimeType === "video/mp4" ? "mp4" : "webm";
        const recordedFile = new File(
          [new Blob(recordedChunks, { type: recordedMimeType })],
          `recording-${formatRecordingTimestamp(new Date())}.${extension}`,
          { type: recordedMimeType },
        );

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        downloadRecordedVideo(recordedFile);
        setSelectedVideoFile(recordedFile);
        setClientError(null);
        addDebugLog(
          `Saved recording ${recordedFile.name} (${formatMegabytes(recordedFile.size)}) locally.`,
        );
        void submitVideo(recordedFile, recordedMimeType);
      };

      recorder.start();
      setIsRecording(true);
      addDebugLog(
        `Started screen recording (${getSupportedMimeType(recorder.mimeType) || "browser default"}).`,
      );
    } catch (error) {
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      discardRecordingRef.current = false;
      setIsRecording(false);

      const message =
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "NotAllowedError")
          ? "Screen recording was cancelled."
          : error instanceof Error
            ? error.message
            : "Unknown recording error.";

      setClientError(message);
      addDebugLog(`Recording failed: ${message}`);
    }
  }

  function setSelectedVideoFile(file: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      previewUrlRef.current = objectUrl;
      setVideoPreviewUrl(objectUrl);
    } else {
      setVideoPreviewUrl(null);
    }

    setSelectedVideo(file);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Link
              href="/"
              className="inline-flex items-center text-sm text-gray-400 transition hover:text-gray-200"
            >
              Back to home
            </Link>
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.28em] text-cyan-300/80">
                Video To Detailed Description
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white">
                Simple AI SDK video describer
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-gray-400 md:text-base">
                Upload an mp4 or webm, or record a fresh screen capture. The
                route streams a structured execution-oriented description using
                Gemini through the Vercel AI SDK.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            <p>This page now sends the real file bytes.</p>
            <p>Large-file limits depend on your deployment, not this UI.</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-gray-800 bg-gray-900/70 p-6 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="video-upload"
                  className="text-sm font-medium text-gray-200"
                >
                  Video recording
                </label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    id="video-upload"
                    ref={fileInputRef}
                    type="file"
                    accept={VIDEO_UPLOAD_ACCEPT}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;

                      if (file) {
                        setSelectedVideoFile(file);
                        addDebugLog(
                          `Selected file ${file.name} (${file.type || "unknown"}, ${formatMegabytes(file.size)}).`,
                        );
                      } else {
                        setSelectedVideoFile(null);
                        addDebugLog("Cleared file selection.");
                      }

                      setClientError(null);
                    }}
                    disabled={isLoading || isRecording}
                    className="block w-full rounded-2xl border border-dashed border-gray-700 bg-gray-950 px-4 py-4 text-sm text-gray-300 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-950 hover:file:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleRecordVideo}
                    disabled={isLoading || (!canRecordVideo && !isRecording)}
                    className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50 md:self-start"
                  >
                    {isRecording ? "Stop recording" : "Record video"}
                  </button>
                </div>
                {selectedVideo ? (
                  <p className="text-xs text-gray-400">
                    {selectedVideo.name} · {formatMegabytes(selectedVideo.size)}
                  </p>
                ) : null}
                <p className="text-xs text-gray-500">
                  Upload an existing mp4/webm, or record a new screen capture in
                  the browser.
                </p>
              </div>

              {videoPreviewUrl ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-200">Preview</p>
                  <video
                    controls
                    src={videoPreviewUrl}
                    className="max-h-64 w-full rounded-2xl border border-gray-800 bg-black"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label
                  htmlFor="user-instructions"
                  className="text-sm font-medium text-gray-200"
                >
                  Optional instructions
                </label>
                <textarea
                  id="user-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  disabled={isLoading}
                  placeholder="Example: This recording shows how I triage support tickets and escalate billing issues."
                  className="min-h-40 w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-cyan-400/60"
                />
              </div>

              {clientError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {clientError}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={isLoading || isRecording}
                  className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-gray-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? "Generating..." : "Generate description"}
                </button>

                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  disabled={!isLoading}
                  className="rounded-full border border-gray-700 px-5 py-3 text-sm font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Stop
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  disabled={
                    !selectedVideo && !instructions.trim() && completion.length === 0
                  }
                  className="rounded-full border border-gray-800 px-5 py-3 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-3xl border border-gray-800 bg-[#0b1020] shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-white">Streamed output</p>
                <p className="text-xs text-gray-400">
                  Status: {isLoading ? "streaming" : "idle"}
                </p>
              </div>
            </div>

            <div className="p-5">
              {completion ? (
                <div className="whitespace-pre-wrap rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm leading-6 text-gray-100">
                  {completion}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 px-6 py-12 text-center text-sm text-gray-500">
                  Upload a video and submit instructions to stream the generated
                  description here.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-amber-400/10 px-5 py-4">
            <div>
              <p className="text-sm font-medium text-white">Debug logs</p>
              <p className="text-xs text-gray-400">
                Client-side request trace for this page.
              </p>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-5">
            {debugEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 px-6 py-8 text-center text-sm text-gray-500">
                No debug events yet.
              </div>
            ) : (
              <div className="space-y-2 font-mono text-xs text-amber-100">
                {debugEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-amber-400/10 bg-gray-950/70 px-3 py-2"
                  >
                    <span className="mr-3 text-amber-300/70">
                      {entry.timestamp}
                    </span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getSupportedVideoMimeType(file: File): string | null {
  const mimeTypeFromFile = getSupportedMimeType(file.type);

  if (mimeTypeFromFile) {
    return mimeTypeFromFile;
  }

  const normalizedName = file.name.toLowerCase();

  if (normalizedName.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (normalizedName.endsWith(".webm")) {
    return "video/webm";
  }

  return null;
}

function getSupportedMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType) {
    return null;
  }

  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase();

  return SUPPORTED_VIDEO_MIME_TYPES.includes(
    normalizedMimeType as (typeof SUPPORTED_VIDEO_MIME_TYPES)[number],
  )
    ? normalizedMimeType
    : null;
}

function getPreferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return RECORDING_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatRecordingTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

function downloadRecordedVideo(file: File) {
  const downloadUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");

  anchor.href = downloadUrl;
  anchor.download = file.name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}
