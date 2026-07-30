import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { getAuthEnv } from "@/lib/config";

const env = getAuthEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Провайдера немає, коли env не заповнені: тоді жоден вхід не можливий і
  // гейт у proxy.ts закриває дашборд, замість того щоб віддавати його всім.
  providers: env
    ? [GitHub({ clientId: env.clientId, clientSecret: env.clientSecret })]
    : [],
  secret: env?.secret,
  // Без цього Auth.js у production-збірці відкидає будь-який запит як
  // UntrustedHost, якщо не заданий AUTH_URL. Хост тут довіряти безпечно:
  // домени віддає Vercel, а callback URL звіряє сам GitHub зі своїм OAuth-app.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // Дашборд — на одного власника, тому allow-list звіряємо з GitHub login,
    // а не з email: email у профілі GitHub може бути приватним і прийти null.
    signIn({ profile }) {
      if (!env) return false;
      return profile?.login === env.allowedLogin;
    },
    jwt({ token, profile }) {
      if (typeof profile?.login === "string") {
        token.login = profile.login;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.login === "string") {
        session.user.login = token.login;
      }
      return session;
    },
  },
});
