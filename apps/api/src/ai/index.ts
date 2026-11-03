import type { AIProvider } from "./AIProvider";
import { GroqProvider } from "./GroqProvider";

let provider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!provider) provider = new GroqProvider();
  return provider;
}

export type { AIProvider, ChatMessage, CompletionRequest, CompletionResult, ModelTier } from "./AIProvider";