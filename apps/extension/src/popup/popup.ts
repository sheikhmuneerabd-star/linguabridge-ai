import { LANGUAGES, TONES, getLanguageName, type Tone } from "@linguabridge/shared";
import { ExtError, send } from "../shared/client";
import type { MeData } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type View = "loading" | "signedOut" | "setup" | "signedIn";

const TONE_LABELS: Record<Tone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  formal: "Formal",
  confident: "Confident",
  persuasive: "Persuasive",
};

let mode: "login" | "register" = "login";
let busy = false;
let me: MeData | null = null;

function show(view: View) {
  for (const id of ["loading", "signedOut", "setup", "signedIn"]) {
    $(id).hidden = id !== view;
  }
}

function setText(id: string, text: string | null) {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
}

function setServer(online: boolean) {
  $("dot").className = `dot ${online ? "online" : "offline"}`;
  $("serverText").textContent = online ? "Server is online" : "Server is offline";
}

function friendly(err: unknown): string {
  return err instanceof ExtError ? err.message : "Something went wrong. Please try again.";
}

// ---------- Sign in / register ----------
function applyMode() {
  const register = mode === "register";
  $("nameRow").hidden = !register;
  $<HTMLInputElement>("name").required = register;
  const password = $<HTMLInputElement>("password");
  password.minLength = register ? 8 : 0;
  password.autocomplete = register ? "new-password" : "current-password";
  $("submitBtn").textContent = register ? "Create account" : "Sign in";
  $("modeText").textContent = register ? "Already have an account?" : "New here?";
  $("toggleMode").textContent = register ? "Sign in" : "Create an account";
  setText("authError", null);
}

$("toggleMode").addEventListener("click", () => {
  mode = mode === "login" ? "register" : "login";
  applyMode();
});

$<HTMLInputElement>("showPassword").addEventListener("change", (e) => {
  $<HTMLInputElement>("password").type = (e.target as HTMLInputElement).checked ? "text" : "password";
});

$<HTMLFormElement>("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return; // ignore double submits
  busy = true;

  const button = $<HTMLButtonElement>("submitBtn");
  button.disabled = true;
  setText("authError", null);

  const email = $<HTMLInputElement>("email").value.trim();
  const password = $<HTMLInputElement>("password").value;

  try {
    if (mode === "register") {
      const name = $<HTMLInputElement>("name").value.trim();
      await send({ type: "AUTH_REGISTER", name, email, password });
    } else {
      await send({ type: "AUTH_LOGIN", email, password });
    }
    $<HTMLInputElement>("password").value = "";
    await loadSession();
  } catch (err) {
    if (err instanceof ExtError && err.code === "EMAIL_IN_USE") {
      mode = "login";
      applyMode();
      setText("authError", "This email is already registered. Enter your password and sign in.");
    } else {
      setText("authError", friendly(err));
    }
  } finally {
    busy = false;
    button.disabled = false;
  }
});

// ---------- Google ----------
$("googleBtn").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  setText("authError", null);
  $("googleHint").hidden = false;
  try {
    // Chrome usually closes this popup while the Google window is open.
    // Sign-in still finishes in the background; reopen the popup to continue.
    await send({ type: "AUTH_GOOGLE" });
    await loadSession();
  } catch (err) {
    setText("authError", friendly(err));
  } finally {
    busy = false;
    $("googleHint").hidden = true;
  }
});

// ---------- Setup (onboarding / change settings) ----------
function fillSelect(id: string, options: { value: string; label: string }[], selected: string) {
  const select = $<HTMLSelectElement>(id);
  select.replaceChildren(
    ...options.map((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = o.value === selected;
      return opt;
    })
  );
}

function showSetup(editing: boolean) {
  if (!me) return;
  const langs = LANGUAGES.map((l) => ({ value: l.code, label: l.name }));
  fillSelect("displayLang", langs, me.preferences.displayLanguage);
  fillSelect("writingLang", langs, me.preferences.writingLanguage);
  fillSelect(
    "tone",
    TONES.map((t) => ({ value: t, label: TONE_LABELS[t] })),
    me.preferences.tone
  );

  $("setupTitle").textContent = editing ? "Change settings" : "Welcome! Choose your languages";
  $("setupSub").hidden = editing;
  $("saveSetup").textContent = editing ? "Save" : "Save and continue";
  $("cancelSetup").hidden = !editing;
  setText("setupError", null);
  show("setup");
}

$<HTMLFormElement>("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy || !me) return;
  busy = true;

  const button = $<HTMLButtonElement>("saveSetup");
  button.disabled = true;
  setText("setupError", null);

  try {
    const result = await send({
      type: "SAVE_PREFERENCES",
      values: {
        displayLanguage: $<HTMLSelectElement>("displayLang").value,
        writingLanguage: $<HTMLSelectElement>("writingLang").value,
        tone: $<HTMLSelectElement>("tone").value as Tone,
      },
    });
    me = { ...me, preferences: result.preferences };
    renderSignedIn();
  } catch (err) {
    setText("setupError", friendly(err));
  } finally {
    busy = false;
    button.disabled = false;
  }
});

$("cancelSetup").addEventListener("click", () => renderSignedIn());

// ---------- Signed in ----------
function renderSignedIn() {
  if (!me) return;
  $("userName").textContent = me.user.name;
  $("userEmail").textContent = me.user.email;
  $("sumDisplay").textContent = getLanguageName(me.preferences.displayLanguage);
  $("sumWriting").textContent = getLanguageName(me.preferences.writingLanguage);
  $("sumTone").textContent = TONE_LABELS[me.preferences.tone];
  show("signedIn");
}

async function loadSession() {
  try {
    me = await send({ type: "GET_ME" });
    if (!me) {
      show("signedOut");
    } else if (!me.preferences.onboardingDone) {
      showSetup(false);
    } else {
      renderSignedIn();
    }
  } catch (err) {
    show("signedOut");
    setText("authError", friendly(err));
  }
}

$("changeSettings").addEventListener("click", () => showSetup(true));

$("openPanel").addEventListener("click", async () => {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch {
    // Nothing to do: the user can try again.
  }
});

$("signOut").addEventListener("click", async () => {
  await send({ type: "AUTH_LOGOUT" }).catch(() => undefined);
  me = null;
  show("signedOut");
});

applyMode();
send({ type: "HEALTH" })
  .then((r) => setServer(r.online))
  .catch(() => setServer(false));
loadSession();