// github.ts лежить у src/lib/, але цей файл живе тут: vitest.config.mts
// підхоплює лише src/components/**/*.test.tsx (src/lib/*.test.mts зарезервовано
// за node --test, який не вміє vi.mock) — інакше файл просто не запускався б
// через `npm test`. Мокаємо лише "server-only" (маркер, не логіка) і
// "@/lib/config" (джерело env) — сама github.ts виконується по-справжньому.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getGithubEnv } = vi.hoisted(() => ({ getGithubEnv: vi.fn() }));
vi.mock("@/lib/config", () => ({ getGithubEnv }));

import {
  ALLOWED_ROOTS,
  fetchConfigFile,
  fetchConfigTree,
  fetchLastCommit,
} from "@/lib/github";

const ENV = { token: "ghp_SUPER_SECRET_TOKEN", owner: "tknysh-dev", repo: "ideas-scout", branch: "main" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  getGithubEnv.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

// --- відсутній токен ------------------------------------------------------

describe("GITHUB_TOKEN не налаштовано", () => {
  test("fetchConfigTree кидає помилку і не звертається в мережу", async () => {
    getGithubEnv.mockReturnValue(null);
    await expect(fetchConfigTree()).rejects.toThrow("GITHUB_TOKEN не налаштовано");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fetchConfigFile кидає помилку і не звертається в мережу", async () => {
    getGithubEnv.mockReturnValue(null);
    await expect(fetchConfigFile("shared/contracts.md")).rejects.toThrow(
      "GITHUB_TOKEN не налаштовано",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fetchLastCommit кидає помилку і не звертається в мережу", async () => {
    getGithubEnv.mockReturnValue(null);
    await expect(fetchLastCommit("shared/contracts.md")).rejects.toThrow(
      "GITHUB_TOKEN не налаштовано",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

// --- мережа недоступна власнику: помилка мережі, 404, битий JSON, таймаут --

describe("власник бачить, коли GitHub недоступний", () => {
  beforeEach(() => getGithubEnv.mockReturnValue(ENV));

  test("помилка мережі (fetch відхиляється) — пропагується без обгортки", async () => {
    const netError = new TypeError("fetch failed");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(netError);
    await expect(fetchConfigTree()).rejects.toThrow("fetch failed");
  });

  // ghFetch не має AbortController/таймауту — з погляду коду "таймаут" це та
  // сама мережева помилка, яку кидає сам fetch. Фіксуємо це як факт: жодного
  // власного повідомлення на кшталт "GitHub не відповідає" код не додає.
  test("таймаут (AbortError від fetch) — пропагується як є, без власного повідомлення", async () => {
    const timeoutError = new DOMException("The operation timed out.", "TimeoutError");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutError);
    await expect(fetchConfigTree()).rejects.toBe(timeoutError);
  });

  test("404 — кидає помилку з шляхом і статусом", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 404));
    await expect(fetchConfigFile("shared/contracts.md")).rejects.toThrow(
      /відповів 404/,
    );
  });

  test("500 — та сама обгортка з фактичним статусом", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(fetchConfigTree()).rejects.toThrow(/відповів 500/);
  });

  test("невалідний JSON у відповіді — res.json() відхиляється, помилка пропагується", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    await expect(fetchConfigTree()).rejects.toThrow("Unexpected token");
  });

  test("порожня відповідь ({}) — fetchConfigTree повертає порожній список, не падає", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await expect(fetchConfigTree()).resolves.toEqual([]);
  });

  // --- токен не повинен потрапляти в повідомлення помилки ------------------

  test("токен не витікає в повідомлення помилки при 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 404));
    try {
      await fetchConfigFile("shared/contracts.md");
      throw new Error("мало кинути");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(ENV.token);
    }
  });

  test("токен не витікає в повідомлення мережевої помилки", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError(`connect failed for token ${ENV.token}`),
    );
    // Це синтетичний найгірший сценарій: якщо низькорівнева бібліотека колись
    // підставить токен у власне повідомлення, ghFetch це нічим не фільтрує —
    // документуємо цю відсутність захисту, а не вигадуємо його.
    await expect(fetchConfigTree()).rejects.toThrow(ENV.token);
  });

  test("Authorization-заголовок формується як Bearer <token> (сам токен іде лише в заголовок)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ tree: [] }));
    await fetchConfigTree();
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.token}`);
  });
});

// --- fetchConfigTree: фільтрація за ALLOWED_ROOTS і типом -----------------

describe("fetchConfigTree — фільтрація дерева", () => {
  beforeEach(() => getGithubEnv.mockReturnValue(ENV));

  test("лишає лише blob у дозволених коренях, відкидає tree і чужі шляхи", async () => {
    const tree = [
      { path: "agents/prompts/collector.md", type: "blob" },
      { path: "agents/prompts", type: "tree" },
      { path: "shared/contracts.md", type: "blob" },
      { path: "dashboard/src/lib/github.ts", type: "blob" },
      { path: "README.md", type: "blob" },
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ tree }));
    const result = await fetchConfigTree();
    expect(result).toEqual([
      { path: "agents/prompts/collector.md", type: "blob" },
      { path: "shared/contracts.md", type: "blob" },
    ]);
  });

  test("точний збіг кореня (без /) теж дозволений", async () => {
    const tree = [{ path: "shared", type: "blob" }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ tree }));
    const result = await fetchConfigTree();
    expect(result).toEqual([{ path: "shared", type: "blob" }]);
  });

  test("запитує саме /git/trees/<branch>?recursive=1", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ tree: [] }));
    await fetchConfigTree();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `https://api.github.com/repos/${ENV.owner}/${ENV.repo}/git/trees/${ENV.branch}?recursive=1`,
    );
  });
});

// --- fetchConfigFile --------------------------------------------------------

describe("fetchConfigFile", () => {
  beforeEach(() => getGithubEnv.mockReturnValue(ENV));

  test("шлях поза ALLOWED_ROOTS — кидає помилку без звернення в мережу", async () => {
    await expect(fetchConfigFile("agents/scripts/runner.sh")).rejects.toThrow(
      "Шлях поза дозволеними директоріями",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // isAllowedPath нормалізує ".."-сегменти (posix.normalize) перед перевіркою
  // кореня: "shared/../secrets.env" зводиться до "secrets.env", який уже не
  // входить у ALLOWED_ROOTS, тому в GitHub API нічого не летить.
  test("шлях із '..', що виходить за межі дозволеного кореня, відхиляється без звернення в мережу", async () => {
    await expect(fetchConfigFile("shared/../secrets.env")).rejects.toThrow(
      "Шлях поза дозволеними директоріями",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // Перевірка дозволеності дивиться на нормалізований шлях, але сам запит
  // летить із шляхом як є — тут нормалізація нічого не забороняє, лише
  // визначає, чи шлях лишається всередині ALLOWED_ROOTS.
  test("шлях із '..', що після нормалізації лишається в межах дозволеного кореня, проходить", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ content: Buffer.from("x").toString("base64"), sha: "s" }),
    );
    await fetchConfigFile("shared/foo/../contracts.md");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/contents/shared/foo/../contracts.md?ref=main");
  });

  test("шлях, що піднімається вище кореня репозиторію ('../secrets.env'), відхиляється", async () => {
    await expect(fetchConfigFile("../secrets.env")).rejects.toThrow(
      "Шлях поза дозволеними директоріями",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("декодує base64-вміст і повертає sha", async () => {
    const content = Buffer.from("# Привіт\nтест", "utf-8").toString("base64");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ content, sha: "abc123" }),
    );
    const file = await fetchConfigFile("shared/contracts.md");
    expect(file).toEqual({
      path: "shared/contracts.md",
      content: "# Привіт\nтест",
      sha: "abc123",
    });
  });
});

// --- fetchLastCommit --------------------------------------------------------

describe("fetchLastCommit", () => {
  beforeEach(() => getGithubEnv.mockReturnValue(ENV));

  test("повертає дату й повідомлення першого коміту в масиві", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        { commit: { author: { date: "2026-01-01T00:00:00Z" }, message: "fix: щось" } },
      ]),
    );
    const info = await fetchLastCommit("shared/contracts.md");
    expect(info).toEqual({ date: "2026-01-01T00:00:00Z", message: "fix: щось" });
  });

  test("порожній масив комітів — date і message null", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
    const info = await fetchLastCommit("shared/contracts.md");
    expect(info).toEqual({ date: null, message: null });
  });

  test("відповідь не масив (несподівана форма) — трактується як відсутній коміт", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ message: "Not Found" }));
    const info = await fetchLastCommit("shared/contracts.md");
    expect(info).toEqual({ date: null, message: null });
  });
});

test("ALLOWED_ROOTS експортується для перевикористання (config-files.ts, architecture.ts)", () => {
  expect(ALLOWED_ROOTS).toEqual([
    "agents/prompts",
    "agents/criteria",
    "agents/catalogs",
    "shared",
  ]);
});
