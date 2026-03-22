import { spawn } from "child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const DEFAULT_CODEX_REASONING_EFFORT = "medium";
const OUTPUT_SCHEMA_FILENAME = "codex-output-schema.json";
const OUTPUT_MESSAGE_FILENAME = "codex-output.json";
const CODEX_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RESERVED_WORKSPACE_FILENAMES = new Set([
  OUTPUT_SCHEMA_FILENAME,
  OUTPUT_MESSAGE_FILENAME,
]);

export interface CodexSessionEvent {
  type: "status" | "message" | "file_change" | "warning";
  message: string;
}

export interface CodexWorkspaceFile {
  filename: string;
  content: string;
}

export interface RunCodexArtifactSessionInput {
  prompt: string;
  workspaceFiles: CodexWorkspaceFile[];
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: CodexSessionEvent) => void;
}

export interface RunCodexArtifactSessionResult {
  sessionId: string | null;
  model: string;
  reasoningEffort: string;
  summary: string;
  artifact: {
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
  };
}

interface CodexOutputPayload {
  summary?: unknown;
  artifactPath?: unknown;
}

interface CodexJsonEvent {
  type?: string;
  thread_id?: string;
  item?: {
    type?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    text?: string;
    changes?: Array<{
      path?: string;
      kind?: string;
    }>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export async function runCodexArtifactSession(
  input: RunCodexArtifactSessionInput,
): Promise<RunCodexArtifactSessionResult> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "codex-artifact-"));
  const model = input.model?.trim() || DEFAULT_CODEX_MODEL;
  const reasoningEffort =
    input.reasoningEffort?.trim() || DEFAULT_CODEX_REASONING_EFFORT;

  try {
    await writeWorkspaceFiles(workspaceDir, input.workspaceFiles);
    await writeOutputSchema(workspaceDir);

    input.onEvent?.({
      type: "status",
      message: `Launching agent with ${model} (${reasoningEffort} reasoning).`,
    });

    const { sessionId } = await executeCodex({
      workspaceDir,
      prompt: input.prompt,
      model,
      reasoningEffort,
      onEvent: input.onEvent,
    });

    const output = await readStructuredOutput(workspaceDir);
    const artifactPath = await resolveArtifactPath(workspaceDir, output.artifactPath);
    const artifactBytes = new Uint8Array(await readFile(artifactPath));

    return {
      sessionId,
      model,
      reasoningEffort,
      summary: output.summary,
      artifact: {
        filename: path.basename(artifactPath),
        mediaType: inferMediaType(artifactPath),
        bytes: artifactBytes,
      },
    };
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

async function writeWorkspaceFiles(
  workspaceDir: string,
  workspaceFiles: CodexWorkspaceFile[],
) {
  for (const file of workspaceFiles) {
    const normalizedFilename = path.basename(file.filename.trim());

    if (!normalizedFilename || normalizedFilename !== file.filename.trim()) {
      throw new Error(`Invalid workspace filename: "${file.filename}".`);
    }

    if (RESERVED_WORKSPACE_FILENAMES.has(normalizedFilename)) {
      throw new Error(`Reserved workspace filename: "${normalizedFilename}".`);
    }

    await writeFile(path.join(workspaceDir, normalizedFilename), file.content, "utf8");
  }
}

async function writeOutputSchema(workspaceDir: string) {
  await writeFile(
    path.join(workspaceDir, OUTPUT_SCHEMA_FILENAME),
    JSON.stringify(
      {
        type: "object",
        properties: {
          summary: { type: "string" },
          artifactPath: { type: "string" },
        },
        required: ["summary", "artifactPath"],
        additionalProperties: false,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function executeCodex(input: {
  workspaceDir: string;
  prompt: string;
  model: string;
  reasoningEffort: string;
  onEvent?: (event: CodexSessionEvent) => void;
}): Promise<{ sessionId: string | null }> {
  const args = [
    "exec",
    "--model",
    input.model,
    "--json",
    "--skip-git-repo-check",
    "--full-auto",
    "-c",
    `model_reasoning_effort="${input.reasoningEffort}"`,
    "--output-schema",
    path.join(input.workspaceDir, OUTPUT_SCHEMA_FILENAME),
    "-o",
    path.join(input.workspaceDir, OUTPUT_MESSAGE_FILENAME),
    "-",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: input.workspaceDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let sessionId: string | null = null;
    let stdoutBuffer = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, CODEX_RUN_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = tryParseJsonEvent(line);

        if (event?.type === "thread.started" && event.thread_id) {
          sessionId = event.thread_id;
          input.onEvent?.({
            type: "status",
            message: `Agent session started: ${event.thread_id}`,
          });
        }

        if (event?.type === "item.completed" && event.item?.type === "file_change") {
          const changedPaths = (event.item.changes ?? [])
            .map((change) => change.path)
            .filter((value): value is string => Boolean(value))
            .map((value) => path.basename(value));

          if (changedPaths.length > 0) {
            input.onEvent?.({
              type: "file_change",
              message: `Agent wrote ${changedPaths.join(", ")}`,
            });
          }
        }

        if (event?.type === "item.started" && event.item?.type === "command_execution") {
          const formattedCommand = formatCommand(event.item.command);

          if (formattedCommand) {
            input.onEvent?.({
              type: "message",
              message: `$ ${formattedCommand}`,
            });
          }
        }

        if (
          event?.type === "item.completed" &&
          event.item?.type === "command_execution"
        ) {
          const formattedCommand = formatCommand(event.item.command);
          const output = event.item.aggregated_output?.trim();
          const exitCode =
            typeof event.item.exit_code === "number" ? event.item.exit_code : null;

          if (formattedCommand) {
            input.onEvent?.({
              type: "status",
              message:
                exitCode === null
                  ? `Completed: ${formattedCommand}`
                  : `Completed (${exitCode}): ${formattedCommand}`,
            });
          }

          if (output) {
            input.onEvent?.({
              type: "message",
              message: output,
            });
          }
        }

        if (event?.type === "item.completed" && event.item?.type === "agent_message") {
          const text = event.item.text?.trim();

          if (text) {
            const structuredMessage = tryParseStructuredAgentMessage(text);
            input.onEvent?.({
              type: "message",
              message:
                structuredMessage?.summary
                  ? `Agent drafted the final response: ${structuredMessage.summary}`
                  : text,
            });
          }
        }

        if (event?.type === "turn.completed" && event.usage) {
          input.onEvent?.({
            type: "status",
            message: `Agent turn completed (${event.usage.input_tokens ?? 0} input tokens, ${event.usage.output_tokens ?? 0} output tokens).`,
          });
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;

      const trimmed = text.trim();
      if (
        trimmed &&
        !trimmed.includes("failed to open logs db") &&
        !trimmed.includes("migration 2 was previously applied") &&
        !trimmed.includes("state db discrepancy") &&
        !trimmed.includes("Failed to delete shell snapshot")
      ) {
        input.onEvent?.({
          type: "warning",
          message: trimmed,
        });
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (finished) {
        return;
      }

      finished = true;
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (finished) {
        return;
      }

      finished = true;

      if (code === 0) {
        resolve({ sessionId });
        return;
      }

      reject(
        new Error(
          [
            `Codex CLI failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
            stderr.trim(),
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
    });

    child.stdin.end(input.prompt);
  });
}

async function readStructuredOutput(workspaceDir: string): Promise<{
  summary: string;
  artifactPath: string;
}> {
  const outputPath = path.join(workspaceDir, OUTPUT_MESSAGE_FILENAME);
  const outputText = await readFile(outputPath, "utf8");
  const output = JSON.parse(outputText) as CodexOutputPayload;

  if (typeof output.summary !== "string" || output.summary.trim().length === 0) {
    throw new Error("Codex CLI did not return a usable summary.");
  }

  if (
    typeof output.artifactPath !== "string" ||
    output.artifactPath.trim().length === 0
  ) {
    throw new Error("Codex CLI did not return a usable artifact path.");
  }

  return {
    summary: output.summary.trim(),
    artifactPath: output.artifactPath.trim(),
  };
}

async function resolveArtifactPath(
  workspaceDir: string,
  artifactPath: string,
): Promise<string> {
  const resolvedWorkspace = await realpath(path.resolve(workspaceDir)).catch(() =>
    path.resolve(workspaceDir),
  );
  const resolvedArtifactPath = await realpath(
    path.resolve(workspaceDir, artifactPath),
  ).catch(() => path.resolve(workspaceDir, artifactPath));

  if (
    resolvedArtifactPath !== resolvedWorkspace &&
    !resolvedArtifactPath.startsWith(`${resolvedWorkspace}${path.sep}`)
  ) {
    throw new Error("Codex CLI returned an artifact path outside its workspace.");
  }

  if (RESERVED_WORKSPACE_FILENAMES.has(path.basename(resolvedArtifactPath))) {
    throw new Error("Codex CLI returned a reserved staging file as the artifact.");
  }

  return resolvedArtifactPath;
}

function tryParseJsonEvent(line: string): CodexJsonEvent | null {
  const trimmedLine = line.trim();

  if (!trimmedLine.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmedLine) as CodexJsonEvent;
  } catch {
    return null;
  }
}

function tryParseStructuredAgentMessage(
  text: string,
): { summary?: string } | null {
  try {
    return JSON.parse(text) as { summary?: string };
  } catch {
    return null;
  }
}

function formatCommand(command: string | undefined): string | null {
  if (!command) {
    return null;
  }

  return command
    .replace(/^\/bin\/zsh -lc /, "")
    .replace(/^\/bin\/bash -lc /, "")
    .trim();
}

function inferMediaType(filename: string): string {
  const normalizedFilename = filename.toLowerCase();

  if (normalizedFilename.endsWith(".md")) {
    return "text/markdown";
  }

  if (normalizedFilename.endsWith(".txt")) {
    return "text/plain";
  }

  if (normalizedFilename.endsWith(".json")) {
    return "application/json";
  }

  if (normalizedFilename.endsWith(".csv")) {
    return "text/csv";
  }

  if (normalizedFilename.endsWith(".html")) {
    return "text/html";
  }

  if (normalizedFilename.endsWith(".js")) {
    return "text/javascript";
  }

  if (normalizedFilename.endsWith(".ts")) {
    return "application/typescript";
  }

  if (normalizedFilename.endsWith(".py")) {
    return "text/x-python";
  }

  if (normalizedFilename.endsWith(".pdf")) {
    return "application/pdf";
  }

  return "application/octet-stream";
}
