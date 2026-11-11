"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROFILE_LIMITS as L, profileSchema, type FreelancerProfile } from "@linguabridge/shared";
import { api, ApiError, clearToken, getToken } from "@/lib/api";

interface FormState {
  displayName: string;
  intro: string;
  skills: string;
  technologies: string;
  services: string;
  experience: string;
  capabilities: string;
  portfolioLinks: string;
  pricingNotes: string;
  deliveryNotes: string;
}

const LABELS: Record<string, string> = {
  displayName: "Name",
  intro: "Short introduction",
  skills: "Skills",
  technologies: "Technologies",
  services: "Services",
  experience: "Experience",
  capabilities: "What I can and cannot do",
  portfolioLinks: "Portfolio links",
  pricingNotes: "Pricing notes",
  deliveryNotes: "Delivery notes",
};

const commaList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const lineList = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const key = x.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toForm(p: FreelancerProfile): FormState {
  return {
    displayName: p.displayName,
    intro: p.intro,
    skills: p.skills.join(", "),
    technologies: p.technologies.join(", "),
    services: p.services.join("\n"),
    experience: p.experience,
    capabilities: p.capabilities,
    portfolioLinks: p.portfolioLinks.join("\n"),
    pricingNotes: p.pricingNotes,
    deliveryNotes: p.deliveryNotes,
  };
}

function fromForm(f: FormState) {
  return {
    displayName: f.displayName,
    intro: f.intro,
    skills: unique(commaList(f.skills)),
    technologies: unique(commaList(f.technologies)),
    services: unique(lineList(f.services)),
    experience: f.experience,
    capabilities: f.capabilities,
    portfolioLinks: unique(lineList(f.portfolioLinks)),
    pricingNotes: f.pricingNotes,
    deliveryNotes: f.deliveryNotes,
  };
}

const EMPTY: FormState = toForm(profileSchema.parse({}));

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field(props: {
  id: keyof FormState;
  hint?: string;
  value: string;
  max?: number;
  rows?: number;
  onChange: (v: string) => void;
}) {
  const { id, hint, value, max, rows = 1, onChange } = props;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {LABELS[id]}
      </label>
      {hint && <p className="mb-1 text-sm text-slate-500">{hint}</p>}
      {rows > 1 ? (
        <textarea
          id={id}
          rows={rows}
          maxLength={max}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          maxLength={max}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

type View = "loading" | "signedOut" | "ready";

export default function ProfilePage() {
  const [view, setView] = useState<View>("loading");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setView("signedOut");
      return;
    }
    api<{ profile: FreelancerProfile }>("/profile")
      .then((d) => {
        setForm(toForm(d.profile));
        setView("ready");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          setView("signedOut");
        } else {
          setError(err instanceof Error ? err.message : "Could not load your profile.");
          setView("ready");
        }
      });
  }, []);

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = profileSchema.safeParse(fromForm(form));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${LABELS[String(issue.path[0] ?? "")] ?? "Profile"}: ${issue.message}`);
      return;
    }

    setSaving(true);
    try {
      const d = await api<{ profile: FreelancerProfile }>("/profile", {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      setForm(toForm(d.profile));
      setNotice("Saved.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        setView("signedOut");
      } else {
        setError(err instanceof Error ? err.message : "Could not save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete your freelancer profile? This cannot be undone.")) return;
    setError(null);
    setNotice(null);
    try {
      await api("/profile", { method: "DELETE" });
      setForm(EMPTY);
      setNotice("Profile deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete. Please try again.");
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-blue-600 underline">
          ← Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold">Freelancer profile</h1>
        <p className="text-slate-600">
          Optional. The AI will only use facts that you write here. Write only what is true. If something is not
          here, the AI will not claim it.
        </p>
      </header>

      {view === "loading" && <p className="text-slate-500">Loading...</p>}

      {view === "signedOut" && (
        <p className="rounded-xl border border-slate-200 bg-white p-5">
          Please{" "}
          <Link href="/" className="text-blue-600 underline">
            sign in
          </Link>{" "}
          first.
        </p>
      )}

      {view === "ready" && (
        <form onSubmit={save} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <Field id="displayName" value={form.displayName} max={L.displayName} onChange={set("displayName")} />
          <Field
            id="intro"
            rows={3}
            max={L.intro}
            hint="One or two sentences about you."
            value={form.intro}
            onChange={set("intro")}
          />
          <Field
            id="skills"
            hint="Separate with commas. For example: Web development, E-commerce"
            value={form.skills}
            onChange={set("skills")}
          />
          <Field
            id="technologies"
            hint="Separate with commas. For example: React.js, Next.js, Node.js, MongoDB"
            value={form.technologies}
            onChange={set("technologies")}
          />
          <Field
            id="services"
            rows={4}
            hint="One service per line."
            value={form.services}
            onChange={set("services")}
          />
          <Field
            id="experience"
            rows={3}
            max={L.experience}
            hint="Only real experience. Years, kinds of projects."
            value={form.experience}
            onChange={set("experience")}
          />
          <Field
            id="capabilities"
            rows={3}
            max={L.capabilities}
            hint="What you can do well, and what you do not do. This stops the AI from promising too much."
            value={form.capabilities}
            onChange={set("capabilities")}
          />
          <Field
            id="portfolioLinks"
            rows={3}
            hint="One link per line (http:// or https://). We never open these links; the AI can only mention them."
            value={form.portfolioLinks}
            onChange={set("portfolioLinks")}
          />
          <Field
            id="pricingNotes"
            rows={2}
            max={L.pricingNotes}
            hint="For example: starting prices, how you quote."
            value={form.pricingNotes}
            onChange={set("pricingNotes")}
          />
          <Field
            id="deliveryNotes"
            rows={2}
            max={L.deliveryNotes}
            hint="For example: usual delivery time, how many revisions."
            value={form.deliveryNotes}
            onChange={set("deliveryNotes")}
          />

          <p className="text-sm text-slate-500">
            This is saved in your account. Later, when you press Analyze in the extension, this text will be sent
            together with the chat messages you analyze to our server and to its AI provider (Groq).
          </p>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
              {notice}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
            <button type="button" onClick={remove} className="rounded-lg px-4 py-2 text-red-700 hover:bg-red-50">
              Delete profile
            </button>
          </div>
        </form>
      )}
    </main>
  );
}