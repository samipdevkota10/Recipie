import {
  runCodexArtifactSession,
  type CodexSessionEvent,
  type RunCodexArtifactSessionResult,
} from "@/lib/codex/run-artifact-session";
import { REQUEST_TO_ARTIFACT_PROMPT } from "@/lib/codex/prompts/request-to-artifact";

const INPUT_FILENAME = "task-input.json";

export interface RunCodexRequestTaskSessionInput {
  userRequest: string;
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: CodexSessionEvent) => void;
}

export type RunCodexRequestTaskSessionResult = RunCodexArtifactSessionResult;
export type { CodexSessionEvent };

export async function runCodexRequestTaskSession(
  input: RunCodexRequestTaskSessionInput,
): Promise<RunCodexRequestTaskSessionResult> {
  return runCodexArtifactSession({
    prompt: REQUEST_TO_ARTIFACT_PROMPT,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    onEvent: input.onEvent,
    workspaceFiles: [
      {
        filename: INPUT_FILENAME,
        content: JSON.stringify(
          {
            userRequest: input.userRequest,
          },
          null,
          2,
        ),
      },
    ],
  });
}
