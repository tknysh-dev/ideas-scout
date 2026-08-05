// idea-refs.server.ts лежить у src/lib/, але цей файл живе тут: vitest.config.mts
// підхоплює лише src/components/**/*.test.tsx (src/lib/*.test.mts зарезервовано
// за node --test, який не вміє vi.mock) — інакше файл просто не запускався б
// через `npm test`. Мокаємо "server-only" і "@/lib/supabase/service"; сам
// react-"cache()" поза активним RSC-рендером не мемоізує (перевірено окремо —
// без встановленого dispatcher він просто викликає функцію напряму), тож між
// тестами реєстр не протікає й додаткового скидання стану не треба.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import { resolveIdeaRefs } from "@/lib/idea-refs.server";

function supabaseWith(data: unknown) {
  const select = vi.fn(async () => ({ data }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, select, from };
}

beforeEach(() => {
  getServiceClient.mockReset();
});

describe("resolveIdeaRefs — немає бази (getServiceClient() === null)", () => {
  test("повертає {} навіть якщо текст згадує валідний id", async () => {
    getServiceClient.mockReturnValue(null);
    const refs = await resolveIdeaRefs(["Дивись PI-0001 для деталей."]);
    expect(refs).toEqual({});
  });
});

describe("resolveIdeaRefs — немає згадувань id", () => {
  test("тексти без id -> {} і до бази взагалі не звертається", async () => {
    const { client, from } = supabaseWith([]);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["просто текст без ідентифікаторів"]);
    expect(refs).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  test("порожній масив текстів -> {}", async () => {
    const { client, from } = supabaseWith([]);
    getServiceClient.mockReturnValue(client);
    await expect(resolveIdeaRefs([])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});

describe("resolveIdeaRefs — довідник порожній (data: null)", () => {
  test("id згаданий, але реєстр порожній -> вилучається (не битий лінк)", async () => {
    const { client } = supabaseWith(null);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["Дивись PI-0001."]);
    expect(refs).toEqual({});
  });
});

describe("resolveIdeaRefs — знаходить згадані id в реєстрі", () => {
  const ROWS = [
    { id: "PI-0001", title: "Ідея 1", status: "new", mechanic_summary: "коротко" },
    { id: "APP-0013", title: "Ідея 2", status: "accepted", mechanic_summary: null },
  ];

  test("id, присутній у реєстрі -> потрапляє в результат з полями з mechanic_summary", async () => {
    const { client } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["Пов'язано з PI-0001."]);
    expect(refs).toEqual({
      "PI-0001": { id: "PI-0001", title: "Ідея 1", status: "new", summary: "коротко" },
    });
  });

  test("id, якого немає в реєстрі -> лишається звичайним текстом (вилучається з refs)", async () => {
    const { client } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["Дивись PI-9999, якого не існує."]);
    expect(refs).toEqual({});
  });

  test("exclude прибирає самопосилання, навіть якщо id згаданий у тексті", async () => {
    const { client } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["Схоже на APP-0013."], "APP-0013");
    expect(refs).toEqual({});
  });

  test("той самий id у кількох текстах не дублюється (Set дедуплікує)", async () => {
    const { client, from } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["PI-0001 тут", "і PI-0001 знову тут"]);
    expect(Object.keys(refs)).toEqual(["PI-0001"]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  test("суміш існуючого й неіснуючого id — повертає лише те, що є в реєстрі", async () => {
    const { client } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    const refs = await resolveIdeaRefs(["PI-0001 і PI-9999 разом"]);
    expect(Object.keys(refs)).toEqual(["PI-0001"]);
  });

  test("реєстр запитується з правильними колонками", async () => {
    const { client, select } = supabaseWith(ROWS);
    getServiceClient.mockReturnValue(client);
    await resolveIdeaRefs(["PI-0001"]);
    expect(select).toHaveBeenCalledWith("id,title,status,mechanic_summary");
  });
});
