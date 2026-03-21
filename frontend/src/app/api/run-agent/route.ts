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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Restoring the working model from original code

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
- \`agent-browser type "<text>" at "<placeholder/label>"\`
- \`agent-browser snapshot -i > raw_snapshot.txt\`
- \`agent-browser screenshot agent_page.png\`

STRATEGY:
1. Don't just open the homepage! If the user wants specific data (e.g. "SF Events on Eventbrite"), you should try to build the search URL directly (like https://www.eventbrite.com/d/ca--san-francisco/all-events/) or use the search immediately.
2. If there are no direct URLs, SEARCH for the category and city using \`agent-browser type "<city/category>" at "<placeholder/label>"\` then click the Search button.
3. Mimic human browsing: wait (2s+) and scroll (500px) multiple times to ensure the results list is actually loaded in the DOM.
4. ALWAYS finish with a snapshot AND a screenshot.
5. IMPORTANT: Add \`echo "STEP: <description>"\` before each major action so the UI can show a status message to the user.

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

Check two things:
1. Are we actually on the RESULTS PAGE for the correct city (e.g., San Francisco)?
2. Is the "LOCATION" or "WHERE" box showing the requested city, or is it showing a default like "Houston"?

Output exactly "CORRECT" only if we are on the results page for the user's specific location.
If it shows a homepage, a generic page, or a different city (like Houston), output "RETRY: <reason>" (e.g. "RETRY: Currently stuck on Houston homepage, need to navigate to SF events").` }
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
            sendData('system', 'Using Gemini AI to parse the final snapshot/screenshot into a dynamic CSV...');
            const csvPrompt = [
                { inlineData: { data: screenshotBase64, mimeType: "image/png" } },
                { text: `Parse this page into a highly detailed, clean CSV format.
User Goal: "${prompt}"

1. Determine the 5-7 most relevant columns for this research goal (e.g. if events: Name, Date, Location; if products: Name, Price, Rating).
2. Extract the data accurately from the screenshot and snapshot text.

Snapshot Text:
${snapshotText.substring(0, 10000)}

Output ONLY the raw CSV data (headers + rows). No markdown formatting.` }
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
