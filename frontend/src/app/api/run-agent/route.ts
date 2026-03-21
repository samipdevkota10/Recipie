import { NextResponse } from 'next/server';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    if (!prompt) return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY is not defined' }, { status: 500 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using 2.0-flash for reliable vision

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const sendData = (type: string, text: string) => {
            const payload = JSON.stringify({ type, text });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        const executeScript = async (scriptPath: string) => {
            return new Promise((resolve, reject) => {
                const child = spawn('bash', [scriptPath]);
                child.stdout.on('data', (data) => sendData('stdout', data.toString()));
                child.stderr.on('data', (data) => sendData('stderr', data.toString()));
                child.on('close', (code) => resolve(code));
                child.on('error', (err) => reject(err));
            });
        };

        const runAgentLoop = async (currentPrompt: string, attempts: number = 0) => {
            sendData('system', attempts === 0 ? `Generating navigation script for: "${currentPrompt}"...` : `Re-navigating based on AI feedback (Attempt ${attempts + 1})...`);

            const systemPrompt = `You are an expert at controlling the \`agent-browser\` CLI to find specific information.
Translate the user's request into a bash script using ONLY these commands:
- \`agent-browser --headed open <url>\`
- \`agent-browser wait <ms>\`
- \`agent-browser find text "<text>" click\`
- \`agent-browser scroll <pixels>\`
- \`agent-browser snapshot -i > raw_snapshot.txt\`
- \`agent-browser screenshot agent_page.png\`

CRITICAL:
1. Mimic human browsing with wait (2000ms+) and scroll (500px) commands.
2. ALWAYS take both a snapshot AND a screenshot at the very end of your script.
3. If this is a re-attempt, be more specific with your navigation.

Output EXACTLY a bash script starting with #!/bin/bash. No markdown block.

Users Request: "${currentPrompt}"`;

            const result = await model.generateContent(systemPrompt);
            let scriptContent = result.response.text();
            scriptContent = scriptContent.replace(/^```bash\n/i, '').replace(/^```\n/i, '').replace(/```$/i, '');

            const scriptDir = path.join(process.cwd(), 'scripts');
            await fs.mkdir(scriptDir, { recursive: true });
            const dynamicScriptPath = path.join(scriptDir, `dynamic_agent_${Date.now()}.sh`);
            await fs.writeFile(dynamicScriptPath, scriptContent, { mode: 0o755 });

            sendData('system', `Executing script:\n${scriptContent}`);
            await executeScript(dynamicScriptPath);
            try { await fs.unlink(dynamicScriptPath); } catch(e) {}

            // Verification Phase
            sendData('system', 'AI is verifying the current page content via screenshot...');
            const screenshotPath = path.join(process.cwd(), 'agent_page.png');
            const snapshotPath = path.join(process.cwd(), 'raw_snapshot.txt');

            let screenshotBase64 = "";
            let snapshotText = "";

            try {
                const imageBuffer = await fs.readFile(screenshotPath);
                screenshotBase64 = imageBuffer.toString('base64');
                snapshotText = await fs.readFile(snapshotPath, 'utf8');
            } catch (e) {
                sendData('stderr', 'Warning: Could not read screenshot or snapshot for verification.');
            }

            if (attempts < 1) { // Allow one retry
                const verifyPrompt = [
                    { inlineData: { data: screenshotBase64, mimeType: "image/png" } },
                    { text: `Analyze this browser screenshot and text snapshot.
User Goal: "${prompt}"
Current Snapshot Content Snippet: ${snapshotText.substring(0, 5000)}

Is the agent currently on a page that directly fulfills the user's request (e.g., a list of tech events) or just a generic landing page?
Output exactly "CORRECT" if we are on the right track.
Otherwise, output "RETRY: <reason>" describing why this is the wrong page and what kind of link or search term to use instead.` }
                ];

                const verificationResult = await model.generateContent(verifyPrompt);
                const verificationText = verificationResult.response.text().trim();

                if (verificationText.startsWith("RETRY") && attempts === 0) {
                    sendData('system', `Verification failed: ${verificationText}. Retrying...`);
                    // Clean up and loop
                    try { await fs.unlink(screenshotPath); } catch(e) {}
                    await runAgentLoop(`${prompt}. Context from previous failure: ${verificationText}`, attempts + 1);
                    return;
                } else {
                    sendData('system', 'Verification passed! Proceeding to data extraction.');
                }
            } else {
                sendData('system', 'Maximum attempts reached or verification passed. Moving to extraction.');
            }

            // Extraction Phase
            sendData('system', 'Using Gemini AI to parse the final snapshot/screenshot into a beautiful CSV...');
            const csvPrompt = [
                { inlineData: { data: screenshotBase64, mimeType: "image/png" } },
                { text: `Parse this page into a highly detailed, clean CSV format.
Extract: Event Name, Full Address/Location, Date & Time, Ticket Link, Description.
Targeting: ${prompt}

Snapshot Text:
${snapshotText.substring(0, 10000)}

Output ONLY the raw CSV data. No markdown headers.` }
            ];

            const csvResult = await model.generateContent(csvPrompt);
            let csvContent = csvResult.response.text();
            csvContent = csvContent.replace(/^```csv\n/i, '').replace(/^```\n/i, '').replace(/```$/i, '');
            
            const csvPath = path.join(process.cwd(), 'extracted_results.csv');
            await fs.writeFile(csvPath, csvContent);
            sendData('system', `Successfully saved beautiful CSV to extracted_results.csv!`);
            
            exec(`open "${csvPath}"`);
            sendData('done', 'Launched CSV viewer! Process complete.');
        };

        try {
            await runAgentLoop(prompt);
        } catch (error: any) {
            sendData('error', `Agent run failed: ${error.message}`);
            sendData('done', 'Process complete with errors.');
        } finally {
            controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
