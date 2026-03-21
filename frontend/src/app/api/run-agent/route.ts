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
} from "@/lib/agent-browser/plan-and-script";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
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
        { status: 500 }
      );
    }

    const geminiApiKey = apiKey;
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const visionModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendData = (type: string, text: string) => {
          const payload = JSON.stringify({ type, text });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        const bin = path.join(process.cwd(), "node_modules", ".bin");
        const headed =
          process.env.AGENT_BROWSER_HEADED === "0" ||
          process.env.AGENT_BROWSER_HEADED === "false"
            ? "false"
            : (process.env.AGENT_BROWSER_HEADED ?? "true");

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

        async function generateAgentScript(currentPrompt: string): Promise<string> {
          const { planModel, scriptModel } = createAgentModels(geminiApiKey);
          const skipPlan =
            process.env.AGENT_SKIP_PLAN === "1" ||
            process.env.AGENT_SKIP_PLAN === "true";

          if (skipPlan) {
            sendData(
              "system",
              "AGENT_SKIP_PLAN is set — generating script in one shot..."
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
              plan
            );
          } catch (planErr: unknown) {
            const msg =
              planErr instanceof Error ? planErr.message : String(planErr);
            sendData(
              "system",
              `Planning failed (${msg}). Falling back to single-shot script generation.`
            );
            return generateScriptSingleShot(scriptModel, currentPrompt);
          }
        }

        const runAgentLoop = async (
          currentPrompt: string,
          attempts: number = 0
        ) => {
          sendData(
            "system",
            attempts === 0
              ? `Generating navigation script for: "${currentPrompt}"...`
              : `Re-navigating based on AI feedback (Attempt ${attempts + 1})...`
          );

          const scriptContent = await generateAgentScript(currentPrompt);

          if (!scriptContent.trim()) {
            sendData("error", "Model returned an empty script.");
            sendData("done", "Process complete with errors.");
            return;
          }

          const scriptDir = path.join(process.cwd(), "scripts");
          await fs.mkdir(scriptDir, { recursive: true });
          const dynamicScriptPath = path.join(
            scriptDir,
            `dynamic_agent_${Date.now()}.sh`
          );
          await fs.writeFile(dynamicScriptPath, scriptContent, { mode: 0o755 });

          sendData("system", `Executing script:\n${scriptContent}`);
          await executeScript(dynamicScriptPath);
          try {
            await fs.unlink(dynamicScriptPath);
          } catch {
            /* ignore */
          }

          sendData(
            "system",
            "AI is verifying the current page content via screenshot..."
          );
          const screenshotPath = path.join(process.cwd(), "agent_page.png");
          const snapshotPath = path.join(process.cwd(), "raw_snapshot.txt");

          let screenshotBase64 = "";
          let snapshotText = "";

          try {
            const imageBuffer = await fs.readFile(screenshotPath);
            screenshotBase64 = imageBuffer.toString("base64");
            snapshotText = await fs.readFile(snapshotPath, "utf8");
          } catch {
            sendData(
              "stderr",
              "Warning: Could not read screenshot or snapshot for verification."
            );
          }

          if (attempts < 1) {
            const verifyPrompt = [
              {
                inlineData: {
                  data: screenshotBase64,
                  mimeType: "image/png",
                },
              },
              {
                text: `Analyze this browser screenshot and text snapshot.
User Goal: "${prompt}"
Current Snapshot Content Snippet: ${snapshotText.substring(0, 5000)}

Is the agent currently on a page that directly fulfills the user's request (e.g., a list of tech events) or just a generic landing page?
Output exactly "CORRECT" if we are on the right track.
Otherwise, output "RETRY: <reason>" describing why this is the wrong page and what kind of link or search term to use instead.`,
              },
            ];

            const verificationResult =
              await visionModel.generateContent(verifyPrompt);
            const verificationText = verificationResult.response.text().trim();

            if (verificationText.startsWith("RETRY") && attempts === 0) {
              sendData(
                "system",
                `Verification failed: ${verificationText}. Retrying...`
              );
              try {
                await fs.unlink(screenshotPath);
              } catch {
                /* ignore */
              }
              await runAgentLoop(
                `${prompt}. Context from previous failure: ${verificationText}`,
                attempts + 1
              );
              return;
            }
            sendData(
              "system",
              "Verification passed! Proceeding to data extraction."
            );
          } else {
            sendData(
              "system",
              "Maximum attempts reached or verification passed. Moving to extraction."
            );
          }

          sendData(
            "system",
            "Using Gemini AI to parse the final snapshot/screenshot into a beautiful CSV..."
          );
          const csvPrompt = [
            {
              inlineData: {
                data: screenshotBase64,
                mimeType: "image/png",
              },
            },
            {
              text: `Parse this page into a highly detailed, clean CSV format.
Extract: Event Name, Full Address/Location, Date & Time, Ticket Link, Description.
Targeting: ${prompt}

Snapshot Text:
${snapshotText.substring(0, 10000)}

Output ONLY the raw CSV data. No markdown headers.`,
            },
          ];

          const csvResult = await visionModel.generateContent(csvPrompt);
          let csvContent = csvResult.response.text();
          csvContent = csvContent
            .replace(/^```csv\n/i, "")
            .replace(/^```\n/i, "")
            .replace(/```$/i, "");

          const csvPath = path.join(process.cwd(), "extracted_results.csv");
          await fs.writeFile(csvPath, csvContent);
          sendData(
            "system",
            "Successfully saved beautiful CSV to extracted_results.csv!"
          );

          exec(`open "${csvPath}"`);
          sendData("done", "Launched CSV viewer! Process complete.");
        };

        try {
          await runAgentLoop(prompt);
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
