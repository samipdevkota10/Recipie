"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { VideoAnalysisResult } from "@/lib/types/video-analysis";

type Phase = "idle" | "analyzing" | "running" | "done" | "error";

const SUPPORTED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
const VIDEO_UPLOAD_ACCEPT = SUPPORTED_VIDEO_MIME_TYPES.join(",");
const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function VideoDescriberClient() {
  // --- Phase state ---
  const [phase, setPhase] = useState<Phase>("idle");

  // --- Video input state ---
  const [instructions, setInstructions] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoJson, setVideoJson] = useState<VideoAnalysisResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [canRecordVideo, setCanRecordVideo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);

  // --- Agent terminal state ---
  const [logs, setLogs] = useState<{ type: string; text: string }[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // --- Browser preview state ---
  const [browserUrl, setBrowserUrl] = useState("about:blank");
  const [browserStatus, setBrowserStatus] = useState("Idle");
  const [scrollPosition, setScrollPosition] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [highlightText, setHighlightText] = useState("");
  const [iframeLikelyBlocked, setIframeLikelyBlocked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const DESKTOP_WIDTH = 1200;

  const isAnalyzing = phase === "analyzing";
  const isRunning = phase === "running";
  const isBusy = isAnalyzing || isRunning;

  // --- Utility functions ---

  const stripAnsi = (str: string) =>
    str.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      "",
    );

  function extractOpenUrl(text: string): string | null {
    const cleanText = stripAnsi(text);
    const openMatch =
      cleanText.match(/open\s+["']?(https?:\/\/[^"'\s]+)["']?/i) ||
      cleanText.match(/Navigate to (https?:\/\/[^\s]+)/i) ||
      cleanText.match(/(https?:\/\/[^\s\u001b]+)/i);
    if (!openMatch) return null;
    const url = openMatch[1].replace(/[\]\)\>]+$/, "");
    if (url.includes("undefined")) return null;
    return url;
  }

  function hostOftenBlocksIframe(url: string): boolean {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return (
        /^(google\.com|gstatic\.com|apmex\.com|jmbullion\.com|facebook\.com|twitter\.com|x\.com|github\.com)$/i.test(
          h,
        ) || h.endsWith(".google.com")
      );
    } catch {
      return false;
    }
  }

  // --- Effects ---

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width } = entries[0].contentRect;
        setScale(width / DESKTOP_WIDTH);
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Log-driven browser preview updates
  useEffect(() => {
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];

    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (
        log.type !== "stdout" &&
        log.type !== "system" &&
        log.type !== "plan"
      )
        continue;
      let url: string | null = null;
      if (log.type === "plan") {
        const m =
          log.text.match(/"start_url"\s*:\s*"([^"]+)"/) ||
          log.text.match(/"starting_url"\s*:\s*"([^"]+)"/);
        if (m?.[1]) url = m[1];
      }
      if (!url) url = extractOpenUrl(log.text);
      if (url) {
        setBrowserUrl(url);
        setIframeLikelyBlocked(hostOftenBlocksIframe(url));
        setBrowserStatus(`Navigating to ${url.split("/")[2]}...`);
        setScrollPosition(0);
        setCursorPos({ x: 50, y: 50 });
        setHighlightText("");
        break;
      }
    }

    if (lastLog.type === "stdout" || lastLog.type === "system") {
      const cleanText = stripAnsi(lastLog.text);

      const scrollDownMatch = cleanText.match(/scroll\s+down\s+(\d+)/i);
      if (scrollDownMatch) {
        setScrollPosition((prev) => prev + parseInt(scrollDownMatch[1], 10));
        setBrowserStatus("Scrolling page...");
      }
      const scrollMatch = cleanText.match(/scroll\s+(\d+)/i);
      if (scrollMatch && !scrollDownMatch) {
        setScrollPosition((prev) => prev + parseInt(scrollMatch[1], 10));
        setBrowserStatus("Scrolling page...");
      }

      const clickMatch = cleanText.match(/find text "([^"]+)" click/i);
      if (clickMatch) {
        setHighlightText(clickMatch[1]);
        setBrowserStatus(`Clicking "${clickMatch[1]}"...`);
        setCursorPos({
          x: 20 + Math.random() * 60,
          y: 20 + Math.random() * 60,
        });
        setIsClicking(true);
        setTimeout(() => setIsClicking(false), 300);
      }

      const typeMatch = cleanText.match(/type\s+"([^"]+)"\s+at\s+"([^"]+)"/i);
      if (typeMatch) {
        setHighlightText(`Typing: ${typeMatch[1]}`);
        setBrowserStatus(`Entering text at ${typeMatch[2]}...`);
        setCursorPos({
          x: 30 + Math.random() * 40,
          y: 30 + Math.random() * 40,
        });
      }

      const waitMatch = cleanText.match(/wait\s+(\d+)/i);
      if (waitMatch) {
        setBrowserStatus(`Waiting ${waitMatch[1]}ms for page to load...`);
      }

      const stepMatch = cleanText.match(/STEP:\s+(.+)/i);
      if (stepMatch) setBrowserStatus(stepMatch[1]);

      if (cleanText.includes("AI is verifying")) {
        setBrowserStatus("AI Vision: Verifying location and content...");
      }
    }

    if (lastLog.type === "done" || lastLog.type === "error") {
      setCursorPos({ x: 50, y: 50 });
    }
    if (lastLog.type === "done") {
      setBrowserStatus("Task Complete!");
      setPhase("done");
    }
    if (lastLog.type === "error") {
      setBrowserStatus("Error in navigation");
    }
  }, [logs]);

  // --- SSE reader ---
  async function readSSEStream(response: Response) {
    if (!response.body) throw new Error("No response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split("\n\n")) {
        if (line.startsWith("data: ")) {
          try {
            const dataObj = JSON.parse(line.substring(6));
            setLogs((prev) => [...prev, dataObj]);
            if (dataObj.type === "done" || dataObj.type === "error") {
              setPhase(dataObj.type === "error" ? "error" : "done");
            }
          } catch {
            console.error("Failed to parse SSE line", line);
          }
        }
      }
    }
  }

  function resetBrowserState() {
    setBrowserUrl("about:blank");
    setIframeLikelyBlocked(false);
    setBrowserStatus("Starting...");
    setScrollPosition(0);
    setCursorPos({ x: 50, y: 80 });
    setHighlightText("");
  }

  // --- Run agent from video JSON ---
  async function runAgent(parsed: VideoAnalysisResult) {
    setPhase("running");
    setLogs([
      {
        type: "system",
        text: `Initializing agent from video: "${parsed.task_title}"...`,
      },
    ]);
    resetBrowserState();

    try {
      const response = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoJson: parsed,
          instructions: instructions.trim() || undefined,
          prompt: instructions.trim() || undefined,
        }),
      });
      await readSSEStream(response);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setLogs((prev) => [...prev, { type: "error", text }]);
      setPhase("error");
    }
  }

  // --- Analyze video, then auto-run agent ---
  async function analyzeAndRun(videoFile: File, mimeType: string) {
    setPhase("analyzing");
    setClientError(null);
    setVideoJson(null);
    setLogs([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const formData = new FormData();
      formData.set(
        "instructions",
        instructions.trim() || "No additional user instructions were provided.",
      );
      formData.set(
        "video",
        new File([videoFile], videoFile.name, { type: mimeType }),
      );

      const response = await fetch("/api/video-describer", {
        method: "POST",
        body: formData,
        signal: ac.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ||
            `Video analysis failed (${response.status})`,
        );
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }
      fullText += decoder.decode();

      let jsonText = fullText.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText
          .replace(/^```json?\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();
      }

      const parsed = JSON.parse(jsonText) as VideoAnalysisResult;
      if (!parsed.actions?.length) {
        throw new Error("Video analysis returned no actions.");
      }
      setVideoJson(parsed);

      await runAgent(parsed);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setPhase("idle");
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setClientError(msg);
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  // --- Form submit handler ---
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || isRecording || !selectedVideo) return;

    const mimeType = getSupportedVideoMimeType(selectedVideo);
    if (!mimeType) {
      setClientError("Only mp4 and webm uploads are supported.");
      return;
    }
    await analyzeAndRun(selectedVideo, mimeType);
  }

  // --- Screen recording ---
  async function handleRecordVideo() {
    if (isBusy) return;

    if (isRecording) {
      discardRecordingRef.current = false;
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!canRecordVideo) {
      setClientError("Screen recording is not available in this browser.");
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
        setClientError(
          "Screen recording failed before the file could be saved.",
        );
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

        if (shouldDiscard || recordedChunks.length === 0) return;

        const extension = recordedMimeType === "video/mp4" ? "mp4" : "webm";
        const recordedFile = new File(
          [new Blob(recordedChunks, { type: recordedMimeType })],
          `recording-${formatRecordingTimestamp(new Date())}.${extension}`,
          { type: recordedMimeType },
        );

        if (fileInputRef.current) fileInputRef.current.value = "";

        downloadRecordedVideo(recordedFile);
        setSelectedVideoFile(recordedFile);
        setClientError(null);
      };

      recorder.start();
      setIsRecording(true);
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

  function handleClear() {
    abortRef.current?.abort();
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
    setInstructions("");
    setSelectedVideoFile(null);
    setClientError(null);
    setVideoJson(null);
    setLogs([]);
    setPhase("idle");
    setIsRecording(false);
    resetBrowserState();
    setBrowserStatus("Idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // --- Derived UI state ---
  const showExecutionPanels = phase !== "idle" && logs.length > 0;

  return (
    <div className="min-h-screen lg:h-screen bg-[#050505] text-gray-100 font-sans selection:bg-indigo-500/30 relative flex flex-col px-4 md:px-8 py-4 md:py-6 overflow-x-hidden lg:overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none z-0" />

      <div className="w-full relative z-10 flex flex-col gap-4 flex-1 h-full min-h-0">
        {/* Header */}
        <header className="flex flex-col gap-3 shrink-0">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="inline-flex items-center justify-center p-3 bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl backdrop-blur-md hidden md:flex hover:bg-white/[0.06] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1" />
                  <path d="M8 12a4 4 0 1 0 8 0" />
                  <path d="M12 2v4m0 8v4" />
                  <path d="M4.22 4.22l2.83 2.83m5.9 5.9l2.83 2.83" />
                  <path d="M19.78 4.22l-2.83 2.83m-5.9 5.9l-2.83 2.83" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-br from-white via-indigo-100 to-indigo-500/50 bg-clip-text text-transparent">
                  Record &amp; Automate
                </h1>
                <p className="text-gray-400 text-xs md:text-sm font-light hidden sm:block">
                  Record a workflow, AI analyzes it, then replays it headless.
                </p>
              </div>
            </div>

            {/* Phase indicator */}
            <div className="flex items-center gap-3 shrink-0">
              {phase !== "idle" && (
                <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-medium ${
                  phase === "analyzing"
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                    : phase === "running"
                      ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                      : phase === "done"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                }`}>
                  {(phase === "analyzing" || phase === "running") && (
                    <div className={`w-2 h-2 rounded-full animate-pulse ${phase === "analyzing" ? "bg-cyan-400" : "bg-indigo-400"}`} />
                  )}
                  {phase === "analyzing" && "Analyzing video..."}
                  {phase === "running" && "Agent executing..."}
                  {phase === "done" && "Complete"}
                  {phase === "error" && "Error"}
                </div>
              )}
              {isBusy && (
                <button
                  onClick={() => { abortRef.current?.abort(); setPhase("idle"); }}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-white/[0.1] rounded-lg hover:bg-white/[0.05] transition-all"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Video input area */}
          <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/[0.05] rounded-2xl p-3 md:p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                {/* Record button */}
                <button
                  type="button"
                  onClick={handleRecordVideo}
                  disabled={isBusy || (!canRecordVideo && !isRecording)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all whitespace-nowrap border ${
                    isRecording
                      ? "bg-red-500/20 border-red-500/60 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                      : "bg-indigo-600/10 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/20 hover:border-indigo-400"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-red-500 animate-pulse" : "bg-indigo-400"}`} />
                  {isRecording ? "Stop Recording" : "Record Screen"}
                </button>

                <span className="text-xs text-gray-600 hidden sm:block">or</span>

                {/* File picker */}
                <label className="flex-1 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={VIDEO_UPLOAD_ACCEPT}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) setSelectedVideoFile(file);
                      else setSelectedVideoFile(null);
                      setClientError(null);
                    }}
                    disabled={isBusy || isRecording}
                    className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-cyan-500 file:cursor-pointer file:transition-colors disabled:opacity-50"
                  />
                </label>

                {/* Analyze & Run button */}
                <button
                  type="submit"
                  disabled={!selectedVideo || isBusy || isRecording}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-[0_0_15px_rgba(79,70,229,0.3)] flex items-center gap-2 whitespace-nowrap text-sm"
                >
                  {isAnalyzing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analyzing...
                    </>
                  ) : isRunning ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Running...
                    </>
                  ) : (
                    "Analyze & Run"
                  )}
                </button>

                {/* Clear */}
                {(selectedVideo || logs.length > 0 || videoJson) && (
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isBusy}
                    className="px-3 py-2 text-sm text-gray-400 hover:text-white border border-white/[0.08] rounded-xl hover:bg-white/[0.05] transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Optional instructions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Optional instructions: e.g. &quot;do this for Dallas instead&quot;..."
                  className="flex-1 bg-black/30 border border-white/[0.06] rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/40 min-w-0"
                  disabled={isBusy}
                />
              </div>

              {/* Inline status: selected file, video preview, error, action chips */}
              {selectedVideo && !videoJson && (
                <p className="text-xs text-gray-500">
                  {selectedVideo.name} &middot; {formatMegabytes(selectedVideo.size)}
                </p>
              )}

              {videoPreviewUrl && !showExecutionPanels && (
                <video
                  controls
                  src={videoPreviewUrl}
                  className="max-h-32 rounded-xl border border-white/[0.06] bg-black"
                />
              )}

              {clientError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {clientError}
                </div>
              )}

              {videoJson && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 space-y-1">
                  <p className="text-sm font-medium text-cyan-200">
                    {videoJson.task_title}
                  </p>
                  <p className="text-xs text-gray-400">
                    {videoJson.user_intent}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {videoJson.actions.map((a) => (
                      <span
                        key={a.seq}
                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[11px] text-gray-300 font-mono"
                      >
                        {a.seq}. {a.type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>
        </header>

        {/* Main content: browser preview + terminal */}
        <div className="flex flex-col lg:flex-row gap-4 flex-1 lg:min-h-0 pb-2">
          {/* Browser Preview */}
          <div className="flex-1 min-h-[500px] lg:min-h-0 bg-[#09090b] border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex flex-col relative">
            <div className="bg-[#18181b] border-b border-white/[0.04] px-4 py-3 flex items-center gap-4 z-20 shrink-0">
              <div className="flex gap-2 shrink-0">
                <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              </div>
              <div className="flex gap-2 shrink-0 opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0 6.74 2.74L21 8" /><path d="M21 21v-5h-5" /></svg>
              </div>
              <div className="flex-1 max-w-xl bg-black/40 border border-white/[0.05] rounded-xl px-4 py-1.5 flex items-center justify-center font-mono text-xs md:text-sm text-gray-300 tracking-wide overflow-hidden whitespace-nowrap text-ellipsis relative group/url">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 opacity-40 shrink-0"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {browserUrl}
                {browserUrl !== "about:blank" && (
                  <div className="absolute right-2 opacity-0 group-hover/url:opacity-100 transition-opacity flex items-center gap-2 bg-black/60 px-2 py-1 rounded-lg backdrop-blur-md">
                    <button
                      onClick={() => window.open(browserUrl, "_blank")}
                      className="hover:text-indigo-400 transition-colors"
                      title="Open in New Tab"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    </button>
                    <button
                      onClick={() => {
                        const originalUrl = browserUrl;
                        setBrowserUrl("about:blank");
                        setTimeout(() => setBrowserUrl(originalUrl), 50);
                      }}
                      className="hover:text-emerald-400 transition-colors"
                      title="Reload Frame"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 21v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 17" /></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div
              ref={containerRef}
              className="flex-1 relative overflow-hidden bg-white text-gray-900 z-10 w-full"
            >
              {/* Status Overlay */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[80] pointer-events-none">
                <div
                  className={`px-4 py-2 rounded-full border shadow-2xl transition-all duration-500 flex items-center gap-3 ${
                    browserStatus === "Task Complete!"
                      ? "bg-emerald-900/90 border-emerald-500/50 text-emerald-100"
                      : browserStatus.includes("Error")
                        ? "bg-rose-900/90 border-rose-500/50 text-rose-100"
                        : "bg-gray-900/90 border-gray-600/50 text-white"
                  }`}
                >
                  {isRunning && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                  )}
                  <span className="text-sm font-medium tracking-wide">
                    {browserStatus}
                  </span>
                </div>
              </div>

              {iframeLikelyBlocked && browserUrl !== "about:blank" && (
                <div className="absolute top-14 left-2 right-2 z-[55] rounded-lg border border-amber-500/40 bg-amber-950/90 text-amber-100 text-xs px-3 py-2 shadow-lg backdrop-blur-sm">
                  <strong className="font-semibold">Preview limit:</strong> This
                  site often{" "}
                  <span className="underline decoration-amber-400/80">
                    blocks embedding in iframes
                  </span>
                  , so the panel may stay blank. Use the &#8599; button to open
                  in a normal tab.
                </div>
              )}

              <div
                className="absolute top-0 left-0 bg-white origin-top-left flex flex-col pointer-events-auto shadow-2xl"
                style={{
                  width: `${DESKTOP_WIDTH}px`,
                  height: `2000px`,
                  transform: `scale(${scale}) translateY(-${scrollPosition * 0.5}px)`,
                  transition:
                    "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {browserUrl !== "about:blank" &&
                !browserUrl.includes("undefined") ? (
                  <iframe
                    src={browserUrl}
                    className="w-full h-full border-0 select-none shadow-inner"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    title="Embedded Agent Browse View"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400 gap-4">
                    {phase === "idle" ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <p className="text-lg font-medium">
                          Record or upload a video to begin
                        </p>
                      </>
                    ) : isAnalyzing ? (
                      <>
                        <div className="w-12 h-12 border-4 border-gray-200 border-t-cyan-500 rounded-full animate-spin" />
                        <p className="text-lg font-medium">
                          Analyzing your recording...
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-lg font-medium">
                          Waiting for page navigation...
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {highlightText && (
                <div
                  className="absolute z-[60] p-3 md:p-4 bg-indigo-100/90 rounded-lg border border-indigo-400 font-medium text-indigo-900 shadow-xl inline-block transition-all duration-300 backdrop-blur-sm pointer-events-none text-sm md:text-base whitespace-nowrap"
                  style={{
                    top: `${cursorPos.y + 5}%`,
                    left: `${cursorPos.x + 5}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  &ldquo;{highlightText}&rdquo;
                </div>
              )}

              <div
                className="absolute pointer-events-none z-[70] transition-all duration-700 ease-out flex items-center justify-center filter drop-shadow-md"
                style={{
                  left: `${cursorPos.x}%`,
                  top: `${cursorPos.y}%`,
                  transform: `translate(-50%, -50%) scale(${isClicking ? 0.8 : 1})`,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M5.5 3.2L18.8 14.1L12.5 15.6L16.2 21.6L13.6 23.2L9.8 17.2L5 20.3L5.5 3.2Z"
                    fill="white"
                    stroke="#1f2937"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </svg>
                {isClicking && (
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-500 animate-ping opacity-75 blur-[1px]" />
                )}
              </div>
            </div>
          </div>

          {/* Terminal Output */}
          <div className="w-full lg:w-[360px] xl:w-[480px] min-h-[400px] lg:min-h-0 bg-[#09090b] border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex flex-col relative shrink-0">
            <div className="bg-white/[0.02] border-b border-white/[0.05] px-4 py-3 flex items-center justify-between relative z-10 font-mono shrink-0">
              <div className="text-xs text-gray-500 tracking-wider uppercase font-semibold">
                Agent Terminal
              </div>
            </div>

            <div
              ref={terminalRef}
              className="flex-1 p-4 md:p-6 overflow-y-auto font-mono text-[13px] md:text-[14px] leading-loose text-gray-300 relative z-10 custom-scrollbar bg-[#050505]"
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 italic gap-3 opacity-60 pb-10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-8 w-8"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <p>Awaiting commands...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, i) => {
                    const isError =
                      log.type === "error" || log.text.includes("[ERROR]");
                    const isDone =
                      log.type === "done" || log.text.includes("[DONE]");
                    const isPlan = log.type === "plan";
                    const isSystem = log.text.includes("[SYSTEM]");

                    return (
                      <div key={i} className="flex group">
                        <span
                          className={`pr-3 opacity-40 select-none group-hover:opacity-100 transition-opacity ${isError ? "text-rose-400" : "text-gray-500"}`}
                        >
                          {String(i + 1).padStart(3, "0")}
                        </span>
                        <span
                          className={`whitespace-pre-wrap flex-1 ${
                            isError
                              ? "text-rose-400 font-medium"
                              : isDone
                                ? "text-emerald-400 font-bold"
                                : isPlan
                                  ? "text-cyan-300/95 border-l-2 border-cyan-500/40 pl-3"
                                  : isSystem
                                    ? "text-indigo-400"
                                    : "text-gray-300"
                          }`}
                        >
                          {log.text}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} className="h-4" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.15); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.3); }
      `,
        }}
      />
    </div>
  );
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getSupportedVideoMimeType(file: File): string | null {
  const mimeTypeFromFile = getSupportedMimeType(file.type);
  if (mimeTypeFromFile) return mimeTypeFromFile;
  const normalizedName = file.name.toLowerCase();
  if (normalizedName.endsWith(".mp4")) return "video/mp4";
  if (normalizedName.endsWith(".webm")) return "video/webm";
  return null;
}

function getSupportedMimeType(
  mimeType: string | null | undefined,
): string | null {
  if (!mimeType) return null;
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase();
  return SUPPORTED_VIDEO_MIME_TYPES.includes(
    normalizedMimeType as (typeof SUPPORTED_VIDEO_MIME_TYPES)[number],
  )
    ? normalizedMimeType
    : null;
}

function getPreferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
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
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
