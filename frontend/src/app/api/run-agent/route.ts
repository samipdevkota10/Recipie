import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not defined in the environment' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const systemPrompt = `You are an expert at generating CLI bash scripts for the \`agent-browser\` tool. 
Your goal is to translate the user's natural language request into a sequence of \`agent-browser\` commands.

The available commands for \`agent-browser\` are:
- \`agent-browser close\`
- \`agent-browser --headed open <url>\`
- \`agent-browser wait <ms>\`
- \`agent-browser find text "<text>" click\`
- \`agent-browser scroll <pixels>\`
- \`agent-browser snapshot -i > <file>\`

You must output EXACTLY a bash script, starting with #!/bin/bash. Do not include markdown formatting like \`\`\`bash. Just the raw text of the script.

Users Request: "${prompt}"`;

    const result = await model.generateContent(systemPrompt);
    let scriptContent = result.response.text();
    
    // Clean up markdown code blocks if the LLM accidentally included them
    scriptContent = scriptContent.replace(/^```bash\n/i, '').replace(/^```\n/i, '').replace(/```$/i, '');

    const scriptDir = path.join(process.cwd(), 'scripts');
    await fs.mkdir(scriptDir, { recursive: true });
    const dynamicScriptPath = path.join(scriptDir, `dynamic_agent_${Date.now()}.sh`);
    
    await fs.writeFile(dynamicScriptPath, scriptContent, { mode: 0o755 });

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      start(controller) {
        const sendData = (type: string, text: string) => {
            const payload = JSON.stringify({ type, text });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }

        sendData('system', 'Gemini successfully generated the agent-browser script! Executing...');
        sendData('system', `Script contents:\n${scriptContent}`);

        // Spawn the shell process
        const child = spawn('bash', [dynamicScriptPath]);

        child.stdout.on('data', (data) => {
            sendData('stdout', data.toString());
        });

        child.stderr.on('data', (data) => {
            sendData('stderr', data.toString());
        });

        child.on('close', async (code) => {
            sendData('done', `Exited with code ${code}`);
            controller.close();
            // Cleanup the temporary script
            try {
                await fs.unlink(dynamicScriptPath);
            } catch(e) {}
        });
        
        child.on('error', (err) => {
            sendData('error', `Failed to start agent: ${err.message}`);
            controller.close();
        });
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
