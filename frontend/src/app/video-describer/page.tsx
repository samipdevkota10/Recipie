"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface DebugEntry {
  id: string;
  message: string;
  timestamp: string;
}

export default function VideoDescriberPage() {
  const [instructions, setInstructions] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [completion, setCompletion] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
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

    if (isLoading) {
      return;
    }

    if (!selectedVideo) {
      setClientError("Select an mp4 recording before submitting.");
      addDebugLog("Submit blocked: no video selected.");
      return;
    }

    if (selectedVideo.type !== "video/mp4") {
      setClientError("Only mp4 uploads are supported on this page right now.");
      addDebugLog(`Submit blocked: unsupported file type ${selectedVideo.type}.`);
      return;
    }

    setClientError(null);
    setCompletion("");
    setIsLoading(true);
    addDebugLog(
      `Submitting ${selectedVideo.name} (${formatMegabytes(selectedVideo.size)}) with ${instructions.trim().length} instruction chars.`,
    );

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const formData = new FormData();
      formData.set(
        "instructions",
        instructions.trim() || "No additional user instructions were provided.",
      );
      formData.set("video", selectedVideo);

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
    addDebugLog("Cleared current video, output, and client state.");
    setInstructions("");
    setSelectedVideo(null);
    setVideoPreviewUrl(null);
    setClientError(null);
    setCompletion("");
    setIsLoading(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
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
                Upload an mp4 and optional instructions. The route streams a
                structured execution-oriented description using Gemini through
                the Vercel AI SDK.
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
                  MP4 recording
                </label>
                <input
                  id="video-upload"
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;

                    if (previewUrlRef.current) {
                      URL.revokeObjectURL(previewUrlRef.current);
                      previewUrlRef.current = null;
                    }

                    if (file) {
                      const objectUrl = URL.createObjectURL(file);
                      previewUrlRef.current = objectUrl;
                      setVideoPreviewUrl(objectUrl);
                      addDebugLog(
                        `Selected file ${file.name} (${file.type || "unknown"}, ${formatMegabytes(file.size)}).`,
                      );
                    } else {
                      setVideoPreviewUrl(null);
                      addDebugLog("Cleared file selection.");
                    }

                    setSelectedVideo(file);
                    setClientError(null);
                  }}
                  disabled={isLoading}
                  className="block w-full rounded-2xl border border-dashed border-gray-700 bg-gray-950 px-4 py-4 text-sm text-gray-300 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-950 hover:file:bg-cyan-400"
                />
                {selectedVideo ? (
                  <p className="text-xs text-gray-400">
                    {selectedVideo.name} · {formatMegabytes(selectedVideo.size)}
                  </p>
                ) : null}
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
                  disabled={isLoading}
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
