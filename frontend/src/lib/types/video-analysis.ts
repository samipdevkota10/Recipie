export type VideoActionType =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "check"
  | "uncheck"
  | "scroll"
  | "press_key"
  | "hover"
  | "drag"
  | "upload"
  | "download"
  | "screenshot"
  | "copy"
  | "paste"
  | "right_click"
  | "double_click"
  | "wait"
  | "close"
  | "switch_tab";

export interface VideoAction {
  seq: number;
  type: VideoActionType;
  description: string;
  target: string | null;
  value: string | null;
  url_at_action: string | null;
}

export interface VideoAnalysisResult {
  task_title: string;
  user_intent: string;
  starting_url: string | null;
  actions: VideoAction[];
}
