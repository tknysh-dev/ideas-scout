import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_PATHS,
  isPublic,
  jwt,
  session,
  signIn,
  unconfigured,
  type AuthEnv,
} from "./auth-logic.ts";

const ENV: AuthEnv = {
  secret: "s3cr3t",
  clientId: "client-id",
  clientSecret: "client-secret",
  allowedLogin: "owner-login",
};

// --- signIn -----------------------------------------------------------

test("signIn: правильний логін проходить", () => {
  assert.equal(signIn(ENV, { login: "owner-login" }), true);
});

test("signIn: чужий логін не проходить", () => {
  assert.equal(signIn(ENV, { login: "someone-else" }), false);
});

test("signIn: логін з іншим регістром не проходить — порівняння чутливе до регістру", () => {
  assert.equal(signIn(ENV, { login: "Owner-Login" }), false);
  assert.equal(signIn(ENV, { login: "OWNER-LOGIN" }), false);
});

test("signIn: profile === undefined не проходить", () => {
  assert.equal(signIn(ENV, undefined), false);
});

test("signIn: profile === null не проходить", () => {
  assert.equal(signIn(ENV, null), false);
});

test("signIn: порожній profile ({}) не проходить", () => {
  assert.equal(signIn(ENV, {}), false);
});

test("signIn: profile.login не рядок (число) не проходить", () => {
  assert.equal(signIn(ENV, { login: 12345 }), false);
});

test("signIn: profile.login не рядок (true) не проходить", () => {
  assert.equal(signIn(ENV, { login: true }), false);
});

// Ключове: без env вхід має бути неможливий БУДЬ-ЯКОМУ профілю, навіть
// такому, що збігся б з allowedLogin, якби env був заповнений.
test("signIn: env === null — завжди false, навіть для правильного логіна", () => {
  assert.equal(signIn(null, { login: "owner-login" }), false);
  assert.equal(signIn(null, { login: "anyone" }), false);
  assert.equal(signIn(null, undefined), false);
  assert.equal(signIn(null, {}), false);
});

// --- jwt / session ------------------------------------------------------

test("jwt: копіює login з профілю в токен", () => {
  const token = jwt({}, { login: "owner-login" });
  assert.equal(token.login, "owner-login");
});

test("jwt: не рядковий login не копіюється", () => {
  const token = jwt({}, { login: 42 });
  assert.equal(token.login, undefined);
});

test("jwt: відсутній profile лишає токен без login", () => {
  const token = jwt({ login: "stale" }, undefined);
  // Функція нічого не змінює, коли profile відсутній (наступні візити без
  // повторного OAuth-обміну) — попередній login у токені лишається як був.
  assert.equal(token.login, "stale");
});

test("session: копіює login з токена в session.user", () => {
  const result = session({ user: {} }, { login: "owner-login" });
  assert.equal(result.user.login, "owner-login");
});

test("session: не рядковий login у токені не копіюється", () => {
  const result = session({ user: {} }, { login: 42 });
  assert.equal(result.user.login, undefined);
});

// --- isPublic -----------------------------------------------------------

test("isPublic: кожен шлях із PUBLIC_PATHS публічний", () => {
  for (const path of PUBLIC_PATHS) {
    assert.equal(isPublic(path), true, path);
  }
});

test("isPublic: підшлях публічного шляху теж публічний", () => {
  assert.equal(isPublic("/api/auth/callback/github"), true);
  assert.equal(isPublic("/api/telegram/webhook/anything"), true);
  assert.equal(isPublic("/login/whatever"), true);
});

test("isPublic: шлях, що лише ПОЧИНАЄТЬСЯ так само, але не є підшляхом — не публічний", () => {
  assert.equal(isPublic("/loginX"), false);
  assert.equal(isPublic("/api/telegram/webhook-evil"), false);
  assert.equal(isPublic("/api/authorization"), false);
});

test("isPublic: порожній шлях не публічний", () => {
  assert.equal(isPublic(""), false);
});

test("isPublic: шлях із '..' звіряється як звичайний рядок (без нормалізації)", () => {
  // Документує фактичну поведінку: isPublic не розв'язує '..', це робить
  // сам URL-парсер до того, як pathname дійде сюди. Рядок, що просто
  // ПОЧИНАЄТЬСЯ префіксом публічного шляху, вважається публічним підшляхом —
  // навіть якщо він семантично веде кудись інде.
  assert.equal(isPublic("/api/auth/../../secret"), true);
  assert.equal(isPublic("/../login"), false);
});

test("isPublic: регістр має значення — шлях з іншим регістром не публічний", () => {
  assert.equal(isPublic("/Login"), false);
  assert.equal(isPublic("/LOGIN"), false);
});

test("isPublic: вебхук Telegram публічний, решта /api/* — ні", () => {
  assert.equal(isPublic("/api/telegram/webhook"), true);
  assert.equal(isPublic("/api/decide"), false);
  assert.equal(isPublic("/api/deep-research"), false);
  assert.equal(isPublic("/api"), false);
});

// --- unconfigured ---------------------------------------------------------

test("unconfigured: у development пускає все, навіть непублічне", () => {
  assert.equal(unconfigured("development", "/"), "allow");
  assert.equal(unconfigured("development", "/api/decide"), "allow");
  assert.equal(unconfigured("development", "/login"), "allow");
});

test("unconfigured: у production пускає лише публічне", () => {
  assert.equal(unconfigured("production", "/login"), "allow");
  assert.equal(unconfigured("production", "/api/auth/callback/github"), "allow");
  assert.equal(unconfigured("production", "/api/telegram/webhook"), "allow");
});

test("unconfigured: у production все інше редіректить на /login — fail closed", () => {
  // Це та сама поломка, що вже була: попередня версія при відсутності env
  // пускала всіх у проді. Тест ловить регрес, якщо хтось знову зробить allow.
  assert.equal(unconfigured("production", "/"), "redirect-to-login");
  assert.equal(unconfigured("production", "/api/decide"), "redirect-to-login");
  assert.equal(unconfigured("production", "/loginX"), "redirect-to-login");
});

test("unconfigured: NODE_ENV === undefined трактується як не-development — fail closed", () => {
  assert.equal(unconfigured(undefined, "/"), "redirect-to-login");
  assert.equal(unconfigured(undefined, "/login"), "allow");
});

test("unconfigured: 'Development' (інший регістр) — НЕ development, fail closed", () => {
  assert.equal(unconfigured("Development", "/"), "redirect-to-login");
});
