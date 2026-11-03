import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

/** Returns the userId, or throws if the token is invalid/expired. */
export function verifyToken(token: string): string {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (typeof payload === "string" || !payload.sub) {
    throw new Error("Invalid token payload");
  }
  return payload.sub;
}