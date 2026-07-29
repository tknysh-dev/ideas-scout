import type { Metadata } from "next";
import { Alegreya, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { getServiceClient } from "@/lib/supabase/service";
import "./globals.css";

const display = Alegreya({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Реєстр ідей — ideas-scout",
  description: "Особистий дашборд власника системи ideas-scout",
};

async function getPendingDecisionsCount(): Promise<number> {
  const supabase = getServiceClient();
  if (!supabase) return 0;
  const { count } = await supabase
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved_pending");
  return count ?? 0;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pendingDecisions = await getPendingDecisionsCount();

  return (
    <html lang="uk" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="flex min-h-screen">
          <Sidebar pendingDecisions={pendingDecisions} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
