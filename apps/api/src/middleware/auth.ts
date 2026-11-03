import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";
import { verifyToken } from "../utils/jwt";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "UNAUTHORIZED", "Please sign in to continue."));
  }

  try {
    res.locals.userId = verifyToken(header.slice(7));
    next();
  } catch {
    next(new AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again."));
  }
}