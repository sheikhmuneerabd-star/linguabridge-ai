import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@linguabridge/shared";
import { AppError } from "../utils/AppError";

export function notFound(_req: Request, res: Response) {
  const body: ApiErrorBody = {
    error: { code: "NOT_FOUND", message: "This page or endpoint does not exist." },
  };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    return res.status(err.statusCode).json(body);
  }

  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: { code: "VALIDATION_ERROR", message: "Some of the information sent is not valid." },
    };
    return res.status(400).json(body);
  }

  // Malformed JSON body
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed") {
    const body: ApiErrorBody = {
      error: { code: "BAD_REQUEST", message: "The request could not be read." },
    };
    return res.status(400).json(body);
  }

  // Unknown error: log on the server, don't leak details to the client.
  console.error("Unexpected error:", err);
  const body: ApiErrorBody = {
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  };
  res.status(500).json(body);
}