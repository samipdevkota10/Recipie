import {
  runCodexArtifactSession,
  type CodexSessionEvent,
  type RunCodexArtifactSessionResult,
} from "@/lib/codex/run-artifact-session";
import { VIDEO_TASK_TO_ARTIFACT_PROMPT } from "@/lib/codex/prompts/video-task-to-artifact";

const INPUT_FILENAME = "video-task-input.json";

export interface RunCodexVideoTaskSessionInput {
  userRequest: string;
  videoTaskDescription: string;
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: CodexSessionEvent) => void;
}

export type RunCodexVideoTaskSessionResult = RunCodexArtifactSessionResult;
export type { CodexSessionEvent };

export async function runCodexVideoTaskSession(
  input: RunCodexVideoTaskSessionInput,
): Promise<RunCodexVideoTaskSessionResult> {
  return runCodexArtifactSession({
    prompt: VIDEO_TASK_TO_ARTIFACT_PROMPT,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    onEvent: input.onEvent,
    workspaceFiles: [
      {
        filename: INPUT_FILENAME,
        content: JSON.stringify(
          {
            userRequest: input.userRequest,
            videoTaskDescription: input.videoTaskDescription,
          },
          null,
          2,
        ),
      },
    ],
  });
}
