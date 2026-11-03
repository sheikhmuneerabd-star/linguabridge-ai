/**
 * "fast"  = cheap/quick model for simple jobs (translation)
 * "smart" = stronger model for analysis (Phase 5)
 */
export type ModelTier = "fast" | "smart";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  tier: ModelTier;
  messages: ChatMessage[];
  /** Ask the model to reply with a JSON object only. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Lets the caller cancel (e.g. user kept typing). */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}