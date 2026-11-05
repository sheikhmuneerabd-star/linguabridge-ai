import type { RequestMessage, Reply, ResponseMap } from "./messages";

export class ExtError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ExtError";
  }
}

export async function send<K extends RequestMessage["type"]>(
  message: Extract<RequestMessage, { type: K }>
): Promise<ResponseMap[K]> {
  let reply: Reply<ResponseMap[K]> | undefined;

  try {
    reply = await chrome.runtime.sendMessage(message);
  } catch {
    throw new ExtError(
      "EXTENSION_ERROR",
      "The extension was updated or restarted. Please close this window and open it again."
    );
  }

  if (!reply) {
    throw new ExtError("NO_RESPONSE", "No answer from the extension. Please try again.");
  }
  if (!reply.ok) {
    throw new ExtError(reply.error.code, reply.error.message);
  }
  return reply.data;
}