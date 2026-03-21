"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { VideoAnalysisResult } from "@/lib/types/video-analysis";

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
  const router = useRouter();
  const [instructions, setInstructions] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [completion, setCompletion] = useState("");
  const [parsedVideoJson, setParsedVideoJson] = useState<VideoAnalysisResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [canRecordVideo, setCanRecordVideo] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);

  // Try to parse the streamed completion as VideoAnalysisResult JSON whenever it changes
  useEffect(() => {
    if (!completion || isLoading) {
      setParsedVideoJson(null);
      return;
    }
    try {
      let jsonText = completion.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText
          .replace(/^```json?\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();
      }
      const parsed = JSON.parse(jsonText) as VideoAnalysisResult;
      if (parsed.actions?.length) {
        setParsedVideoJson(parsed);
      } else {
        setParsedVideoJson(null);
      }
    } catch {
      setParsedVideoJson(null);
    }
  }, [completion, isLoading]);

  function handleRunInAgentBrowser() {
    if (!parsedVideoJson) return;
    sessionStorage.setItem(
      "pendingVideoJson",
      JSON.stringify(parsedVideoJson),
    );
    router.push("/");
  }

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

    console.debug(`[record-and-automate] ${message}`);
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
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden">
      {/* Animated Background Gradients - matching landing page */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full bg-cyan-600/10 blur-[150px] pointer-events-none" />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col px-4 md:px-8 py-8 md:py-12">
        {/* Header with back button */}
        <header className="flex items-center justify-between mb-12">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-400 transition-colors mb-4"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to Home
            </Link>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-br from-white via-indigo-100 to-indigo-500/50 bg-clip-text text-transparent">
              Record Your Workflow
            </h1>
            <p className="text-gray-400 text-lg mt-3 max-w-2xl">
              Record a video of any browser task, and AI will extract every action to replay it automatically.
            </p>
          </div>
        </header>

        {/* Main Content Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input Section */}
          <div className="lg:col-span-1 space-y-6">
            {/* Video Input Card */}
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-6 md:p-8 shadow-2xl">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Recording Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                    <label className="text-sm font-semibold text-white uppercase tracking-wider">
                      Video Input
                    </label>
                  </div>

                  <div className="space-y-3">
                    {/* Record Button */}
                    <button
                      type="button"
                      onClick={handleRecordVideo}
                      disabled={isLoading || (!canRecordVideo && !isRecording)}
                      className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-semibold transition-all duration-300 border-2 ${
                        isRecording
                          ? "bg-red-500/20 border-red-500 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                          : "bg-indigo-600/10 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/20 hover:border-indigo-400"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className={`w-3 h-3 rounded-full ${isRecording ? "bg-red-500 animate-pulse" : "bg-indigo-400"}`} />
                      {isRecording ? "● Stop Recording" : "● Start Recording"}
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <span className="text-xs text-gray-500 uppercase tracking-wider">or</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </div>

                    {/* Upload Input */}
                    <label className="block">
                      <input
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
                        className="hidden"
                      />
                      <div className="w-full px-4 py-3 rounded-2xl border-2 border-dashed border-cyan-500/40 bg-cyan-500/5 hover:border-cyan-400 hover:bg-cyan-500/10 transition-all cursor-pointer text-center text-sm text-cyan-200 font-medium disabled:opacity-50">
                        📁 Upload Video (MP4/WebM)
                      </div>
                    </label>
                  </div>

                  {selectedVideo && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
                      <p className="text-xs font-medium text-emerald-200">
                        ✓ {selectedVideo.name}
                      </p>
                      <p className="text-xs text-emerald-200/70 mt-1">
                        {formatMegabytes(selectedVideo.size)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Instructions */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                    <label className="text-sm font-semibold text-white uppercase tracking-wider">
                      Instructions (Optional)
                    </label>
                  </div>
                  <textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    disabled={isLoading}
                    placeholder="Example: Extract tech events from Eventbrite in San Francisco..."
                    className="w-full h-24 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all resize-none"
                  />
                </div>

                {/* Error */}
                {clientError && (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-start gap-3">
                    <span className="text-lg mt-0.5">⚠️</span>
                    <span>{clientError}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-3 pt-2">
                  <button
                    type="submit"
                    disabled={isLoading || isRecording || !selectedVideo}
                    className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-50 disabled:hover:from-indigo-600 disabled:hover:to-indigo-500 text-white font-semibold rounded-2xl transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)] flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        ✨ Analyze Video
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={!selectedVideo && !instructions.trim() && completion.length === 0}
                    className="w-full px-6 py-2 border border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.05] text-gray-300 hover:text-white font-medium rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                </div>
              </form>
            </div>

            {/* Preview Card */}
            {videoPreviewUrl && (
              <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-6 shadow-2xl">
                <p className="text-sm font-semibold text-white mb-3 uppercase tracking-wider">Preview</p>
                <video
                  controls
                  src={videoPreviewUrl}
                  className="w-full rounded-2xl border border-white/[0.1] bg-black"
                />
              </div>
            )}
          </div>

          {/* Right Column - Analysis Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Analysis Output Card */}
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-8 shadow-2xl min-h-[400px] flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-sm font-semibold text-white uppercase tracking-wider">Analysis Result</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {isLoading ? "🔄 Processing your video..." : "✓ Ready to execute"}
                  </p>
                </div>
              </div>

              <div className="flex-1">
                {completion ? (
                  <div className="whitespace-pre-wrap rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm leading-6 text-gray-100 max-h-[500px] overflow-y-auto font-mono">
                    {completion}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/[0.08] bg-white/[0.01]">
                    <div className="text-5xl mb-4">🎬</div>
                    <p className="text-gray-400 text-center">
                      Record or upload a video to see the extracted actions
                    </p>
                  </div>
                )}
              </div>

              {/* Detected Actions */}
              {parsedVideoJson && !isLoading && (
                <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-lg font-bold text-emerald-200">
                      {parsedVideoJson.actions.length} Actions Detected
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-emerald-100">{parsedVideoJson.task_title}</p>
                    <p className="text-xs text-emerald-200/80">{parsedVideoJson.user_intent}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {parsedVideoJson.actions.slice(0, 8).map((a) => (
                      <span
                        key={a.seq}
                        className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white/[0.08] border border-white/[0.1] text-xs text-gray-200 font-mono"
                      >
                        {a.type}
                      </span>
                    ))}
                    {parsedVideoJson.actions.length > 8 && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white/[0.08] border border-white/[0.1] text-xs text-gray-400">
                        +{parsedVideoJson.actions.length - 8} more
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleRunInAgentBrowser}
                    className="w-full mt-4 px-6 py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 text-lg"
                  >
                    🚀 Execute in Agent Browser
                  </button>
                </div>
              )}
            </div>

            {/* Debug Toggle */}
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="w-full px-4 py-3 rounded-2xl border border-white/[0.08] bg-white/[0.01] hover:bg-white/[0.02] text-gray-400 hover:text-gray-200 text-sm font-medium transition-all"
            >
              {showDebug ? "Hide Debug Logs" : "Show Debug Logs"}
            </button>

            {/* Debug Logs - Collapsible */}
            {showDebug && (
              <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 backdrop-blur-md p-6 shadow-2xl">
                <p className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Debug Logs</p>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {debugEntries.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No debug events yet.</p>
                  ) : (
                    <div className="space-y-1 font-mono text-xs text-amber-100">
                      {debugEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg bg-gray-950/50 px-2.5 py-1.5 text-amber-100/80"
                        >
                          <span className="text-amber-300/60">{entry.timestamp}</span>
                          <span className="mx-2 text-gray-600">•</span>
                          <span>{entry.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom gradient blur */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none z-[5]" />
    </div>
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