import type { ApiErrorBody } from "@linguabridge/shared";
import { API_URL } from "./config";
import { clearToken, getToken } from "./storage";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();

  // Always time out after 30 seconds; also stop early if the caller cancels.
  const timeout = AbortSignal.timeout(30_000);
  const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    if (init.signal?.aborted) throw new ApiError("CANCELLED", "Cancelled.", 0);
    if (timeout.aborted) {
      throw new ApiError("TIMEOUT", "The server took too long to answer. Please try again.", 0);
    }
    throw new ApiError("NETWORK_ERROR", "Cannot reach the server. Please check your internet and try again.", 0);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && token && (err?.code === "UNAUTHORIZED" || err?.code === "SESSION_EXPIRED")) {
      await clearToken();
    }
    throw new ApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? "Something went wrong. Please try again.",
      res.status
    );
  }

  return data as T;
}