import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getAuthServerClient } from "@/lib/supabase/server";

// Callback magic link: Supabase лист веде сюди з token_hash + type,
// verifyOtp обмінює їх на сесію (cookie) і редіректить далі.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (tokenHash && type) {
    const supabase = await getAuthServerClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) {
        redirect(next);
      }
    }
  }

  redirect("/login?error=link");
}
