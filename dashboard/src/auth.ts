import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { getAuthEnv } from "@/lib/config";
import * as authLogic from "@/lib/auth-logic";

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
    signIn({ profile }) {
      return authLogic.signIn(env, profile);
    },
    jwt({ token, profile }) {
      // JWT/Session/AdapterUser з next-auth не мають індексного типу, який
      // вимагає auth-logic.ts — кастимо на межі, сама логіка лишається чистою.
      return authLogic.jwt(token as authLogic.AuthToken, profile) as typeof token;
    },
    session({ session, token }) {
      return authLogic.session(session as unknown as authLogic.AuthSession, token as authLogic.AuthToken) as unknown as typeof session;
    },
  },
});
