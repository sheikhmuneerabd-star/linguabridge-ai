import { ApiError } from "../shared/api";
import { GOOGLE_CLIENT_ID } from "../shared/config";

function randomString(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

const FAILED = () =>
  new ApiError("GOOGLE_FAILED", "Google sign-in could not be completed. Please try again.", 0);

export async function getGoogleIdToken(): Promise<{ idToken: string; nonce: string }> {
  if (!GOOGLE_CLIENT_ID) {
    throw new ApiError(
      "GOOGLE_NOT_CONFIGURED",
      "Google sign-in is not set up in this build of the extension.",
      0
    );
  }

  const nonce = randomString();
  const state = randomString();
  const redirectUri = chrome.identity.getRedirectURL();
  // Handy for developers: this exact address must be added in Google Cloud Console.
  console.info("[LinguaBridge] Google redirect URI:", redirectUri);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    nonce,
    state,
    prompt: "select_account",
  }).toString();

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  } catch {
    // Window closed by the user, or Google showed an error page (e.g. redirect address not added).
    throw new ApiError(
      "GOOGLE_CANCELLED",
      "Google sign-in was not completed. If you saw a Google error page, ask the developer to check the redirect address.",
      0
    );
  }
  if (!responseUrl) throw FAILED();

  const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  if (params.get("error")) throw FAILED();
  if (params.get("state") !== state) throw FAILED();

  const idToken = params.get("id_token");
  if (!idToken) throw FAILED();

  return { idToken, nonce };
}