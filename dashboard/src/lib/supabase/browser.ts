"use client";

import { createBrowserClient } from "@supabase/ssr";

// Клієнтський клієнт для сторінки логіну (magic link). Використовує лише
// публічні env — NEXT_PUBLIC_*, ніколи service key.
export function getAuthBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}
