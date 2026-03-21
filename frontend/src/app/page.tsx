"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<{ type: string; text: string }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Helper to strip ANSI escape codes
  const stripAnsi = (str: string) => {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
  };
  
  // Fake Browser State
  const [browserUrl, setBrowserUrl] = useState("about:blank");
  const [scrollPosition, setScrollPosition] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 }); // percentage based on visible area
  const [isClicking, setIsClicking] = useState(false);
  const [highlightText, setHighlightText] = useState("");
  
  // For Scaling the Iframe to forcefully render Desktop layout
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const DESKTOP_WIDTH = 1200; // Force websites to render as 1200px desktop layout

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

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Parse logs for fake browser actions
  useEffect(() => {
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];
    if (lastLog.type === "stdout" || lastLog.type === "system") {
      const cleanText = stripAnsi(lastLog.text);
      
      // agent-browser --headed open <url>
      // Also look for naked URLs that the agent might output during navigation
      const openMatch = cleanText.match(/open\s+(https?:\/\/[^\s]+)/i) || 
                        cleanText.match(/(https?:\/\/[^\s\u001b]+)/i);

      if (openMatch) {
         let url = openMatch[1];
         // Clean up any trailing characters like ] or ) that might be artifacts
         url = url.replace(/[\]\)\>]+$/, "");
         setBrowserUrl(url);
         setScrollPosition(0);
         setCursorPos({ x: 50, y: 50 });
         setHighlightText("");
      }

      // agent-browser scroll <pixels>
      const scrollMatch = cleanText.match(/scroll\s+(\d+)/i);
      if (scrollMatch) {
        setScrollPosition(prev => prev + parseInt(scrollMatch[1], 10));
      }

      // agent-browser find text "<text>" click
      const clickMatch = cleanText.match(/find text "([^"]+)" click/i);
      if (clickMatch) {
        setHighlightText(clickMatch[1]);
        // Move cursor to a realistic location inside the VISIBLE area
        setCursorPos({
          x: 20 + Math.random() * 60, 
          y: 20 + Math.random() * 60
        });
        
        setIsClicking(true);
        setTimeout(() => setIsClicking(false), 300);
      }
    }
    
    if (lastLog.type === "done" || lastLog.type === "error") {
      // Reset fake cursor to middle when done
      setCursorPos({ x: 50, y: 50 });
    }
  }, [logs]);

  const handleRun = async () => {
    if (!prompt.trim() || isRunning) return;
    
    setIsRunning(true);
    setLogs([{ type: "system", text: `Initializing agent-browser for: "${prompt}"...` }]);
    setBrowserUrl("about:blank");
    setScrollPosition(0);
    setCursorPos({ x: 50, y: 80 });
    setHighlightText("");

    try {
      const response = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const dataObj = JSON.parse(line.substring(6));
                    setLogs((prev) => [...prev, dataObj]);
                    if (dataObj.type === "done" || dataObj.type === "error") {
                        setIsRunning(false);
                    }
                } catch {
                    console.error("Failed to parse SSE line", line);
                }
            }
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown client error";
      setLogs((prev) => [...prev, { type: "error", text: message }]);
      setIsRunning(false);
    }
  };

  return (
    // Instead of forced h-screen which squishes mobile, we use min-h-screen for flexibility,
    // but lg:h-screen for desktop to get the perfect split pane.
    <div className="min-h-screen lg:h-screen bg-[#050505] text-gray-100 font-sans selection:bg-indigo-500/30 relative flex flex-col px-4 md:px-8 py-4 md:py-6 overflow-x-hidden lg:overflow-hidden">
      {/* Dynamic Background Effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none z-0" />

      <div className="w-full relative z-10 flex flex-col gap-4 flex-1 h-full min-h-0">
        <header className="flex flex-col md:flex-row items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4 self-start md:self-auto">
            <div className="inline-flex items-center justify-center p-3 bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl backdrop-blur-md hidden md:flex">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4"></path>
                <path d="M12 8h.01"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-br from-white via-indigo-100 to-indigo-500/50 bg-clip-text text-transparent">
                Agent Browser
              </h1>
              <p className="text-gray-400 text-xs md:text-sm font-light hidden sm:block">Watch as the agent seamlessly executes commands.</p>
            </div>
          </div>
          
          <div className="w-full flex-1 md:w-auto md:max-w-xl">
            <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/[0.05] rounded-2xl p-1.5 md:p-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-row gap-2 w-full">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRun();
                }}
                placeholder="Extract SF tech events into my CSV..."
                className="flex-1 bg-transparent px-3 md:px-4 py-2 text-white focus:outline-none placeholder:text-gray-600 text-sm md:text-[15px] font-light min-w-0"
                disabled={isRunning}
              />
              <button
                onClick={handleRun}
                disabled={isRunning || !prompt.trim()}
                className="px-4 md:px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-medium rounded-xl transition-all shadow-[0_0_15px_rgba(79,70,229,0.3)] flex items-center gap-2 whitespace-nowrap text-sm md:text-base"
              >
                {isRunning ? (
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <span>Run</span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Change from fixed min-h-0 strictly to min-h-[500px] on mobile so they stack cleanly, and lg:min-h-0 on desktop so they stretch perfectly. */}
        <div className="flex flex-col lg:flex-row gap-4 flex-1 lg:min-h-0 pb-2">
          
          {/* Fake Browser Container */}
          <div className="flex-1 min-h-[500px] lg:min-h-0 bg-[#09090b] border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex flex-col relative">
            {/* Browser Header Tools */}
            <div className="bg-[#18181b] border-b border-white/[0.04] px-4 py-3 flex items-center gap-4 z-20 shrink-0">
              <div className="flex gap-2 shrink-0">
                <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
              </div>
              <div className="flex gap-2 shrink-0 opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0 6.74 2.74L21 8"/><path d="M21 21v-5h-5"/></svg>
              </div>
              <div className="flex-1 max-w-xl bg-black/40 border border-white/[0.05] rounded-xl px-4 py-1.5 flex items-center justify-center font-mono text-xs md:text-sm text-gray-300 tracking-wide overflow-hidden whitespace-nowrap text-ellipsis relative group/url">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 opacity-40 shrink-0"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                {browserUrl}
                {browserUrl !== "about:blank" && (
                  <div className="absolute right-2 opacity-0 group-hover/url:opacity-100 transition-opacity flex items-center gap-2 bg-black/60 px-2 py-1 rounded-lg backdrop-blur-md">
                    <button 
                      onClick={() => window.open(browserUrl, "_blank")}
                      className="hover:text-indigo-400 transition-colors"
                      title="Open in New Tab"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
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
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 21v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 17"/></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Browser Content Area: Intelligently Scales the Webpage */}
            <div 
              ref={containerRef}
              className="flex-1 relative overflow-hidden bg-white text-gray-900 z-10 w-full"
            >
              {/* Scaled Desktop Screen */}
              <div 
                className="absolute top-0 left-0 bg-white origin-top-left flex flex-col pointer-events-auto"
                style={{ 
                  width: `${DESKTOP_WIDTH}px`, 
                  height: `3000px`, // extremely tall virtual height for the automated scrolling to look real
                  transform: `scale(${scale}) translateY(-${scrollPosition * 0.5}px)`,
                  transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1)'
                }}
              >
                  {browserUrl !== "about:blank" && !browserUrl.includes("undefined") ? (
                    <iframe 
                      src={browserUrl}
                      className="w-full h-full border-0 select-none shadow-inner"
                      sandbox="allow-same-origin allow-scripts allow-forms"
                      title="Embedded Agent Browse View"
                    />
                  ) : (
                    <div className="w-full h-full flex items-start pt-[100px] justify-center">
                      <div className="text-gray-400 text-[18px] flex items-center gap-3">
                        <svg className="animate-spin h-5 w-5 text-gray-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Waiting for page navigation...
                      </div>
                    </div>
                  )}
              </div>

              {/* Overlays float independently over the screen */}
              {highlightText && (
                <div className="absolute z-[60] p-3 md:p-4 bg-indigo-100/90 rounded-lg border border-indigo-400 font-medium text-indigo-900 shadow-xl inline-block transition-all duration-300 backdrop-blur-sm pointer-events-none text-sm md:text-base whitespace-nowrap"
                     style={{ top: `${cursorPos.y + 5}%`, left: `${cursorPos.x + 5}%`, transform: 'translate(-50%, -50%)' }}>
                  "{highlightText}"
                </div>
              )}

              <div 
                className="absolute pointer-events-none z-[70] transition-all duration-700 ease-out flex items-center justify-center filter drop-shadow-md"
                style={{ 
                  left: `${cursorPos.x}%`, 
                  top: `${cursorPos.y}%`,
                  transform: `translate(-50%, -50%) scale(${isClicking ? 0.8 : 1})`
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 3.2L18.8 14.1L12.5 15.6L16.2 21.6L13.6 23.2L9.8 17.2L5 20.3L5.5 3.2Z" fill="white" stroke="#1f2937" strokeLinejoin="round" strokeWidth="1.5"/>
                </svg>
                {isClicking && (
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-500 animate-ping opacity-75 blur-[1px]"></div>
                )}
              </div>
            </div>

            {/* Overlay if not running */}
            {!isRunning && logs.length === 0 && (
                <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center">
                    <div className="text-gray-400 font-medium tracking-wide">Waiting for Agent...</div>
                </div>
            )}
          </div>

          {/* Terminal Output */}
          <div className="w-full lg:w-[360px] xl:w-[480px] min-h-[400px] lg:min-h-0 bg-[#09090b] border border-white/[0.08] rounded-3xl overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex flex-col relative shrink-0">
            <div className="bg-white/[0.02] border-b border-white/[0.05] px-4 py-3 flex items-center justify-between relative z-10 font-mono shrink-0">
              <div className="text-xs text-gray-500 tracking-wider uppercase font-semibold">Agent Terminal</div>
            </div>
            
            <div 
              ref={terminalRef}
              className="flex-1 p-4 md:p-6 overflow-y-auto font-mono text-[13px] md:text-[14px] leading-loose text-gray-300 relative z-10 custom-scrollbar bg-[#050505]"
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 italic gap-3 opacity-60 pb-10">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p>Awaiting commands...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, i) => {
                    const isError = log.type === 'error' || log.text.includes('[ERROR]');
                    const isDone = log.type === 'done' || log.text.includes('[DONE]');
                    const isSystem = log.text.includes('[SYSTEM]');
                    
                    return (
                      <div key={i} className="flex group">
                        <span className={`pr-3 opacity-40 select-none group-hover:opacity-100 transition-opacity ${isError ? 'text-rose-400' : 'text-gray-500'}`}>
                          {String(i + 1).padStart(3, '0')}
                        </span>
                        <span className={`whitespace-pre-wrap flex-1 ${
                          isError ? 'text-rose-400 font-medium' :
                          isDone ? 'text-emerald-400 font-bold' :
                          isSystem ? 'text-indigo-400' :
                          'text-gray-300'
                        }`}>
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
      
      {/* Custom scrollbar syntax for tailwind */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.15);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.3);
        }
      `}} />
    </div>
  );
}
