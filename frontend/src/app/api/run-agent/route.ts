import { NextResponse } from "next/server";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  createAgentModels,
  planAgentTask,
  generateScriptFromPlan,
  generateScriptSingleShot,
  generateScriptFromVideoActions,
} from "@/lib/agent-browser/plan-and-script";
import type { VideoAnalysisResult } from "@/lib/types/video-analysis";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt: string | undefined = body.prompt;
    const videoJson: VideoAnalysisResult | undefined = body.videoJson;
    const instructions: string | undefined = body.instructions;

    if (!prompt && !videoJson) {
      return NextResponse.json(
        { error: "Either prompt or videoJson is required" },
        { status: 400 },
      );
    }

    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Set GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) in frontend/.env.local, then restart the dev server.",
        },
        { status: 500 },
      );
    }

    const geminiApiKey = apiKey;
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const visionModelName =
      process.env.AGENT_VISION_MODEL?.trim() || "gemini-2.5-flash";
    const visionModel = genAI.getGenerativeModel({ model: visionModelName });

    const goalDescription =
      videoJson
        ? `${videoJson.task_title}: ${videoJson.user_intent}`
        : prompt!;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendData = (type: string, text: string) => {
          const payload = JSON.stringify({ type, text });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        const bin = path.join(process.cwd(), "node_modules", ".bin");
        const headed =
          process.env.AGENT_BROWSER_HEADED === "1" ||
          process.env.AGENT_BROWSER_HEADED === "true"
            ? "true"
            : "false";

        const spawnEnv = {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          AGENT_BROWSER_HEADED: headed,
        };

        const executeScript = async (scriptPath: string) => {
          return new Promise<number>((resolve, reject) => {
            const child = spawn("bash", [scriptPath], { env: spawnEnv });
            child.stdout.on("data", (data) => {
              sendData("stdout", data.toString());
            });
            child.stderr.on("data", (data) => {
              sendData("stderr", data.toString());
            });
            child.on("close", (code) => resolve(code ?? 0));
            child.on("error", (err) => reject(err));
          });
        };

        // --- Script generation: video-based or prompt-based ---

        async function generateFromVideo(): Promise<string> {
          const { scriptModel } = createAgentModels(geminiApiKey);
          sendData(
            "system",
            `Generating script from ${videoJson!.actions.length} video-observed actions...`,
          );
          sendData(
            "plan",
            `[VIDEO ACTIONS]\n${JSON.stringify(videoJson, null, 2)}`,
          );
          return generateScriptFromVideoActions(
            scriptModel,
            videoJson!,
            instructions || prompt || "",
          );
        }

        async function generateFromPrompt(
          currentPrompt: string,
        ): Promise<string> {
          const { planModel, scriptModel } = createAgentModels(geminiApiKey);
          const skipPlan =
            process.env.AGENT_SKIP_PLAN === "1" ||
            process.env.AGENT_SKIP_PLAN === "true";

          if (skipPlan) {
            sendData(
              "system",
              "AGENT_SKIP_PLAN is set — generating script in one shot...",
            );
            return generateScriptSingleShot(scriptModel, currentPrompt);
          }

          try {
            sendData("system", "Planning task (structured)...");
            const plan = await planAgentTask(planModel, currentPrompt);
            sendData("plan", `[PLAN]\n${JSON.stringify(plan, null, 2)}`);
            sendData("system", "Generating bash from plan...");
            return await generateScriptFromPlan(
              scriptModel,
              currentPrompt,
              plan,
            );
          } catch (planErr: unknown) {
            const msg =
              planErr instanceof Error ? planErr.message : String(planErr);
            sendData(
              "system",
              `Planning failed (${msg}). Falling back to single-shot script generation.`,
            );
            return generateScriptSingleShot(scriptModel, currentPrompt);
          }
        }

        const runAgentLoop = async (
          currentPrompt: string,
          attempts: number = 0,
        ) => {
          sendData(
            "system",
            attempts === 0
              ? videoJson
                ? `Translating video actions into navigation script...`
                : `Generating navigation script for: "${currentPrompt}"...`
              : `Re-navigating based on AI feedback (Attempt ${attempts + 1})...`,
          );

          const scriptContent =
            attempts === 0 && videoJson
              ? await generateFromVideo()
              : await generateFromPrompt(currentPrompt);

          if (!scriptContent.trim()) {
            sendData("error", "Model returned an empty script.");
            sendData("done", "Process complete with errors.");
            return;
          }

          const scriptDir = path.join(process.cwd(), "scripts");
          await fs.mkdir(scriptDir, { recursive: true });
          const dynamicScriptPath = path.join(
            scriptDir,
            `dynamic_agent_${Date.now()}.sh`,
          );
          await fs.writeFile(dynamicScriptPath, scriptContent, {
            mode: 0o755,
          });

          sendData("system", `Executing script:\n${scriptContent}`);
          await executeScript(dynamicScriptPath);
          try {
            await fs.unlink(dynamicScriptPath);
          } catch {
            /* ignore */
          }

          const screenshotPath = path.join(process.cwd(), "agent_page.png");
          const snapshotPath = path.join(process.cwd(), "raw_snapshot.txt");

          let screenshotBase64 = "";
          let snapshotText = "";

          try {
            const imageBuffer = await fs.readFile(screenshotPath);
            screenshotBase64 = imageBuffer.toString("base64");
          } catch {
            /* optional file */
          }
          try {
            snapshotText = await fs.readFile(snapshotPath, "utf8");
          } catch {
            /* optional file */
          }

          const hasUsableScreenshot =
            screenshotBase64.trim().length >= 200;

          if (!hasUsableScreenshot || !snapshotText.trim()) {
            sendData(
              "stderr",
              "Note: Missing agent_page.png and/or raw_snapshot.txt. " +
                "Verification/CSV will use text-only mode.",
            );
          }

          if (attempts < 1) {
            sendData(
              "system",
              hasUsableScreenshot
                ? "AI is verifying the current page (screenshot + snapshot text)..."
                : "AI is verifying using snapshot text only (no screenshot)...",
            );

            const verifyText = `User Goal: "${goalDescription}"

Current snapshot text (may be empty if the script did not write raw_snapshot.txt):
${snapshotText.substring(0, 8000)}

Check two things:
1. Are we actually on the RESULTS PAGE for the correct query/location?
2. Is the page showing meaningful content toward the user's goal, or is it a generic landing page / wrong city / captcha?

Output exactly "CORRECT" if there is meaningful on-page content toward the goal.
Otherwise output "RETRY: <reason>" with a concrete fix (e.g. use direct URL, different find command).`;

            const verifyPrompt = hasUsableScreenshot
              ? [
                  {
                    inlineData: {
                      data: screenshotBase64,
                      mimeType: "image/png",
                    },
                  },
                  {
                    text: `Analyze this browser screenshot together with the snapshot text.\n\n${verifyText}`,
                  },
                ]
              : [{ text: verifyText }];

            let verificationText = "CORRECT";
            try {
              const verificationResult =
                await visionModel.generateContent(verifyPrompt);
              verificationText = verificationResult.response.text().trim();
            } catch (verErr: unknown) {
              const vm =
                verErr instanceof Error ? verErr.message : String(verErr);
              sendData(
                "stderr",
                `Verification step skipped after API error: ${vm}`,
              );
            }

            if (verificationText.startsWith("RETRY") && attempts === 0) {
              sendData(
                "system",
                `Verification failed: ${verificationText}. Retrying...`,
              );
              try {
                await fs.unlink(screenshotPath);
              } catch {
                /* ignore */
              }
              await runAgentLoop(
                `${goalDescription}. Context from previous failure: ${verificationText}`,
                attempts + 1,
              );
              return;
            }
            sendData(
              "system",
              "Verification finished. Proceeding to data extraction.",
            );
          } else {
            sendData(
              "system",
              "Maximum attempts reached or verification passed. Moving to extraction.",
            );
          }

          sendData(
            "system",
            "Using Gemini to build CSV from available snapshot/screenshot...",
          );

          const csvBody = `Parse into a useful CSV for the user's goal.
Determine the 5-7 most relevant columns for this research goal (e.g. if events: Name, Date, Location; if products: Name, Price, Rating).

User request:
${goalDescription}

Snapshot text (may be partial or empty):
${snapshotText.substring(0, 12000)}

Output ONLY raw CSV data (headers + rows). No markdown fences.`;

          const csvPrompt = hasUsableScreenshot
            ? [
                {
                  inlineData: {
                    data: screenshotBase64,
                    mimeType: "image/png",
                  },
                },
                { text: csvBody },
              ]
            : [{ text: csvBody }];

          let csvContent = "";
          try {
            const csvResult = await visionModel.generateContent(csvPrompt);
            csvContent = csvResult.response.text();
          } catch (csvErr: unknown) {
            const cm =
              csvErr instanceof Error ? csvErr.message : String(csvErr);
            sendData("error", `CSV extraction failed: ${cm}`);
            sendData("done", "Process complete with errors.");
            return;
          }

          csvContent = csvContent
            .replace(/^```csv\n/i, "")
            .replace(/^```\n/i, "")
            .replace(/```$/i, "");

          const csvPath = path.join(process.cwd(), "extracted_results.csv");
          await fs.writeFile(csvPath, csvContent);
          sendData(
            "system",
            "Successfully saved CSV to extracted_results.csv!",
          );

          exec(`open "${csvPath}"`);
          sendData("done", "Launched CSV viewer! Process complete.");
        };

        try {
          await runAgentLoop(prompt || goalDescription);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendData("error", `Agent run failed: ${message}`);
          sendData("done", "Process complete with errors.");
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
