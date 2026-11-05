import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  /** Present when the sign-in flow used a nonce (the extension does). */
  nonce?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();

    if (!p || !p.sub || !p.email || !p.email_verified) {
      throw new Error("Incomplete Google profile");
    }

    return {
      googleId: p.sub,
      email: p.email,
      name: p.name ?? p.email.split("@")[0],
      picture: p.picture,
      nonce: p.nonce,
    };
  } catch {
    throw new AppError(401, "INVALID_GOOGLE_TOKEN", "Google sign-in failed. Please try again.");
  }
}