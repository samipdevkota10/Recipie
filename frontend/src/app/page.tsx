"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden">
      {/* Animated Background Gradients */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full bg-cyan-600/10 blur-[150px] pointer-events-none" />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 md:px-8 py-12">
        <div className="max-w-4xl w-full text-center space-y-12">
          {/* Logo & Badge */}
          <div className="space-y-6">
            <div className="inline-flex items-center justify-center">
              <div className="inline-flex items-center justify-center p-4 bg-white/[0.05] rounded-3xl border border-white/[0.1] shadow-2xl backdrop-blur-md">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-12 h-12 text-indigo-400 drop-shadow-[0_0_12px_rgba(99,102,241,0.6)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="1" />
                  <path d="M8 12a4 4 0 1 0 8 0" />
                  <path d="M12 2v4m0 8v4" />
                  <path d="M4.22 4.22l2.83 2.83m5.9 5.9l2.83 2.83" />
                  <path d="M19.78 4.22l-2.83 2.83m-5.9 5.9l-2.83 2.83" />
                </svg>
              </div>
            </div>

            <div className="space-y-4">
              <div className="inline-block">
                <div className="px-4 py-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 backdrop-blur-sm">
                  <p className="text-sm font-semibold text-indigo-300 tracking-wide">
                    AI-Powered Task Automation
                  </p>
                </div>
              </div>

              <h1 className="text-5xl md:text-7xl font-black tracking-tight bg-gradient-to-br from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent leading-tight">
                Record Once.<br />
                Automate Forever.
              </h1>

              <p className="text-lg md:text-xl text-gray-300 font-light max-w-2xl mx-auto leading-relaxed">
                Turn your screen recordings into executable browser automation. 
                No code needed. Just record what you do, and let AI handle the rest.
              </p>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-6 mt-16">
            {[
              {
                icon: "🎬",
                title: "Record Workflows",
                description: "Capture any browser task with a simple screen recording",
              },
              {
                icon: "🤖",
                title: "AI Analysis",
                description: "Gemini analyzes your video and extracts every action",
              },
              {
                icon: "⚡",
                title: "Artifact Fulfillment",
                description: "Turn extracted workflows into concrete output artifacts",
              },
            ].map((feature, idx) => (
              <div
                key={idx}
                className="group relative p-6 md:p-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all duration-300"
              >
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-600/0 to-cyan-600/0 group-hover:from-indigo-600/5 group-hover:to-cyan-600/5 transition-all duration-300" />
                <div className="relative space-y-3">
                  <p className="text-3xl">{feature.icon}</p>
                  <h3 className="text-lg font-semibold text-white">
                    {feature.title}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Use Cases */}
          <div className="space-y-6 mt-16">
            <h2 className="text-3xl font-bold text-white">
              Perfect For
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                "QA Engineers automating test suites",
                "Support teams documenting workflows",
                "PMs validating product flows",
                "Developers automating repetitive tasks",
              ].map((useCase, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-4 rounded-lg border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm"
                >
                  <div className="flex-shrink-0 mt-1">
                    <svg
                      className="w-5 h-5 text-cyan-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <p className="text-gray-300">{useCase}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <div className="mt-20 space-y-6">
            <button
              onClick={() => router.push("/record-and-automate")}
              className="group relative inline-flex items-center justify-center gap-3 px-8 md:px-10 py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold rounded-xl transition-all duration-300 shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_40px_rgba(79,70,229,0.6)] text-lg"
            >
              <span>Start Recording</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 group-hover:translate-x-1 transition-transform"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </button>

            <p className="text-gray-500 text-sm">
              Free to use • No credit card required • Takes 2 minutes
            </p>
          </div>

          {/* Tech Stack Mention */}
          <div className="mt-16 pt-12 border-t border-white/[0.05]">
            <p className="text-gray-500 text-sm mb-4">Powered by</p>
            <div className="flex flex-wrap items-center justify-center gap-6 md:gap-8">
              {[
                { name: "Google Gemini", emoji: "🤖" },
                { name: "OpenAI", emoji: "⚙️" },
                { name: "Next.js", emoji: "▲" },
              ].map((tech, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-gray-400 text-sm hover:text-gray-300 transition-colors"
                >
                  <span>{tech.emoji}</span>
                  <span>{tech.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom gradient blur */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none z-[5]" />
    </div>
  );
}
