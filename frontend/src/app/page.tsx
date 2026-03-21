"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<{ type: string; text: string }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRun = async () => {
    if (!prompt.trim() || isRunning) return;
    
    setIsRunning(true);
    setLogs([{ type: "system", text: `Initializing agent-browser for: "${prompt}"...` }]);

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
                } catch (e) {
                    console.error("Failed to parse SSE line", line);
                }
            }
        }
      }
    } catch (error: any) {
      setLogs((prev) => [...prev, { type: "error", text: error.message }]);
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-purple-500/30">
      <div className="max-w-5xl mx-auto p-6 md:p-12">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center justify-center p-3 bg-purple-500/10 rounded-2xl mb-4 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4"></path>
                <path d="M12 8h.01"></path>
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-br from-white to-gray-500 bg-clip-text text-transparent">
            Agent Browser
          </h1>
          <p className="mt-4 text-gray-400 max-w-2xl mx-auto text-lg">
            Give the agent a prompt, and watch as it executes the commands in your local browser directly on your machine.
          </p>
        </header>

        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 md:p-8 shadow-2xl mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRun();
              }}
              placeholder="e.g., Get SF & Bay Area events from Cerebral Valley..."
              className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-4 py-4 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all placeholder:text-gray-600 text-lg shadow-inner"
              disabled={isRunning}
            />
            <button
              onClick={handleRun}
              disabled={isRunning || !prompt.trim()}
              className="group relative px-8 py-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-[0_0_20px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] overflow-hidden"
            >
              <div className="relative z-10 flex items-center justify-center gap-2 text-lg">
                {isRunning ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Executing...
                  </>
                ) : (
                  <>
                    Run Agent
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:translate-x-1 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>

        <div className="bg-[#0D1117] border border-gray-800 rounded-2xl overflow-hidden shadow-2xl relative flex flex-col h-[500px]">
          <div className="bg-[#161B22] border-b border-gray-800 px-4 py-3 flex items-center gap-2">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
            </div>
            <div className="ml-4 text-xs font-mono text-gray-500">Agent Terminal Output</div>
          </div>
          <div className="flex-1 p-6 overflow-y-auto font-mono text-sm leading-relaxed text-gray-300">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-600 italic">
                Awaiting commands. Enter a prompt above to start the agent.
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className="flex">
                    <span className={`pr-4 opacity-50 select-none ${log.type === 'error' || log.text.includes('[ERROR]') ? 'text-red-400' : 'text-gray-500'}`}>
                      {String(i + 1).padStart(3, '0')}
                    </span>
                    <span className={`whitespace-pre-wrap ${
                        log.type === 'error' || log.text.includes('[ERROR]') ? 'text-red-400 font-semibold' :
                        log.type === 'done' || log.text.includes('[DONE]') ? 'text-green-400 font-bold' :
                        log.text.includes('[SYSTEM]') ? 'text-purple-400 font-semibold italic' :
                        'text-gray-200'
                    }`}>
                      {log.text}
                    </span>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
