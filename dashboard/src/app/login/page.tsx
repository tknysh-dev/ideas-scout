import ConfigNotice from "@/components/ConfigNotice";
import { signIn } from "@/auth";
import { AUTH_VARS, getAuthEnv } from "@/lib/config";

// getAuthEnv() мусить читатись на запит, а не на збірку: інакше сторінка
// запікає стан «налаштовано / ні» на момент деплою і розходиться з proxy,
// який читає ті самі env у рантаймі.
export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = !!getAuthEnv();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {configured ? (
          <div className="rounded-lg border border-line bg-paper-raised p-8">
            <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
              Ideas Scout
            </p>
            <h1 className="mt-1 font-display text-2xl text-ink">Вхід у дашборд</h1>
            <p className="mt-2 text-sm text-ink-dim">
              Доступ лише для акаунта власника на GitHub.
            </p>

            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/" });
              }}
              className="mt-5"
            >
              <button
                type="submit"
                className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
              >
                Увійти через GitHub
              </button>
            </form>

            <LoginError searchParams={searchParams} />
          </div>
        ) : (
          <ConfigNotice title="Авторизацію не налаштовано" vars={[...AUTH_VARS]} />
        )}
      </div>
    </div>
  );
}

async function LoginError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!error) return null;

  const message =
    error === "AccessDenied"
      ? "Цей акаунт GitHub не має доступу до дашборда."
      : "Не вдалося завершити вхід. Спробуй ще раз.";

  return <p className="mt-3 text-xs text-[color:var(--status-rejected-fg)]">{message}</p>;
}
