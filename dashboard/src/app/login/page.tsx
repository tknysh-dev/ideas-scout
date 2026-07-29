"use client";

import { useState } from "react";
import { getAuthBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const supabase = getAuthBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/confirm`
            : undefined,
      },
    });
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper-raised p-8">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Ideas Scout
        </p>
        <h1 className="mt-1 font-display text-2xl text-ink">Вхід у дашборд</h1>

        {!supabase ? (
          <div className="mt-5 rounded-md border border-dashed border-line-strong p-4">
            <p className="text-sm text-ink">Авторизацію не налаштовано.</p>
            <p className="mt-1 text-xs text-ink-dim">
              Потрібні env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </p>
          </div>
        ) : status === "sent" ? (
          <p className="mt-5 text-sm text-ink-dim">
            Лист із посиланням надіслано на <span className="text-ink">{email}</span>.
            Перевір пошту.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "sending" ? "Надсилаємо…" : "Надіслати посилання"}
            </button>
            {status === "error" && (
              <p className="text-xs text-[color:var(--status-rejected-fg)]">{errorMessage}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
