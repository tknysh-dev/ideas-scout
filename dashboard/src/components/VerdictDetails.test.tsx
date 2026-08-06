// VerdictDetails/VerdictRowDetails — жоден не залежить від "server-only" (на
// відміну від CriteriaAnalysis/CompetitorsSection, які тягнуть Card), тож
// монтуємо реально через render()+screen — той самий підхід, що й
// DeepResearchBlocks.test.tsx, де ці компоненти вже рендеряться насправді.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import VerdictDetails, { VerdictRowDetails } from "@/components/VerdictDetails";
import {
  DISAGREEMENT_META,
  RESOLUTION_META,
  TONE_META,
  VERDICT_TONE,
  type CriterionVerdicts,
} from "@/lib/deep-research";
import type { CriteriaVerdictRow, CriterionVerdict, SynthesisResolution } from "@/lib/types";

function verdictRow(
  overrides: Partial<CriteriaVerdictRow> & { id: string; criterion_key: string },
): CriteriaVerdictRow {
  return {
    idea_id: "PI-0001",
    run_id: null,
    stage: "deep",
    kind: "model",
    provider: "openai",
    model: null,
    verdict: "passed",
    score: null,
    summary: null,
    detail: null,
    evidence: null,
    resolution: null,
    criteria_version: null,
    created_at: "2026-01-01T00:00:00.000Z",
    superseded_at: null,
    ...overrides,
  } as CriteriaVerdictRow;
}

function entry(synthesis: CriteriaVerdictRow | null, models: CriteriaVerdictRow[]): CriterionVerdicts {
  return { synthesis, models };
}

describe("VerdictDetails — порожній вхід (synthesis=null, models=[])", () => {
  test("нема ані синтезу, ані моделей — компонент не рендерить нічого", () => {
    const { container } = render(<VerdictDetails entry={entry(null, [])} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("VerdictDetails — лише синтез, без моделей", () => {
  test("synthesis заданий, models=[] — блок з пігулками моделей відсутній", () => {
    const { container } = render(
      <VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", kind: "synthesis" }), [])} />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByText(DISAGREEMENT_META.label)).toBeNull();
  });
});

describe("VerdictDetails — лише моделі, без синтезу", () => {
  test("synthesis=null, одна модель — пігулка «провайдер: лейбл тону» рендериться", () => {
    render(
      <VerdictDetails
        entry={entry(null, [verdictRow({ id: "m1", criterion_key: "1", provider: "openai", verdict: "passed" })])}
      />,
    );
    expect(screen.getByText(`openai: ${TONE_META.passed.label}`)).toBeDefined();
  });

  test("одна модель — розбіжності немає (Set.size===1), пігулка розбіжності не рендериться", () => {
    render(
      <VerdictDetails entry={entry(null, [verdictRow({ id: "m1", criterion_key: "1", verdict: "passed" })])} />,
    );
    expect(screen.queryByText(DISAGREEMENT_META.label)).toBeNull();
  });
});

describe("VerdictDetails — розбіжність моделей (disagreement)", () => {
  test("дві моделі з однаковим вердиктом — пігулки обох моделей є, розбіжності немає", () => {
    render(
      <VerdictDetails
        entry={entry(null, [
          verdictRow({ id: "m1", criterion_key: "1", provider: "openai", verdict: "passed" }),
          verdictRow({ id: "m2", criterion_key: "1", provider: "anthropic", verdict: "passed" }),
        ])}
      />,
    );
    expect(screen.getByText(`openai: ${TONE_META.passed.label}`)).toBeDefined();
    expect(screen.getByText(`anthropic: ${TONE_META.passed.label}`)).toBeDefined();
    expect(screen.queryByText(DISAGREEMENT_META.label)).toBeNull();
  });

  test("дві моделі з різними вердиктами — пігулка «моделі розійшлись» рендериться", () => {
    render(
      <VerdictDetails
        entry={entry(null, [
          verdictRow({ id: "m1", criterion_key: "1", provider: "openai", verdict: "passed" }),
          verdictRow({ id: "m2", criterion_key: "1", provider: "anthropic", verdict: "failed" }),
        ])}
      />,
    );
    expect(screen.getByText(DISAGREEMENT_META.label)).toBeDefined();
  });
});

describe("VerdictDetails — невідоме значення verdict у моделі (поза словником CriterionVerdict)", () => {
  // Задокументована сумнівна поведінка (третій випадок такого патерну в
  // проєкті, поряд із JobsTable і CompetitorsSection): на відміну від
  // DeepResearchBlocks.tsx, де TONE_META[VERDICT_TONE[verdict]] підстраховано
  // тернаром (meta ? ... : "лише моделі"), тут `const meta = TONE_META[...]`
  // використовується одразу без перевірки — невідомий вердикт дає
  // TONE_META[undefined]===undefined, і `meta.label` валить рендер.
  test("вердикт поза словником — компонент падає при рендері", () => {
    const badEntry = entry(null, [
      verdictRow({ id: "m1", criterion_key: "1", verdict: "unexpected_verdict" as CriterionVerdict }),
    ]);
    expect(() => render(<VerdictDetails entry={badEntry} />)).toThrow();
  });

  test("synthesis.verdict поза словником НЕ впливає на VerdictDetails — синтезний verdict тут не використовується (лише resolution/score/detail)", () => {
    // На відміну від DeepResearchBlocks (де synthesis.verdict малює Pill
    // блоку), сам VerdictDetails тон синтезу ніде не читає — тож той самий
    // "поганий" verdict у synthesis не падає.
    const okEntry = entry(
      verdictRow({ id: "s1", criterion_key: "1", kind: "synthesis", verdict: "unexpected_verdict" as CriterionVerdict }),
      [],
    );
    expect(() => render(<VerdictDetails entry={okEntry} />)).not.toThrow();
  });
});

describe("VerdictDetails — резолюція синтезу (resolution)", () => {
  test.each(Object.keys(RESOLUTION_META) as SynthesisResolution[])(
    "resolution='%s' — пігулка з лейблом і підказкою з RESOLUTION_META",
    (resolution) => {
      render(
        <VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", resolution }), [])} />,
      );
      expect(screen.getByText(RESOLUTION_META[resolution].label)).toBeDefined();
      expect(screen.getByText(RESOLUTION_META[resolution].hint)).toBeDefined();
    },
  );

  test("resolution=null — блок резолюції не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", resolution: null }), [])} />);
    expect(screen.queryByText(RESOLUTION_META.consensus.label)).toBeNull();
  });

  test("synthesis=null (лише моделі) — блок резолюції не рендериться (optional chaining)", () => {
    render(
      <VerdictDetails entry={entry(null, [verdictRow({ id: "m1", criterion_key: "1" })])} />,
    );
    expect(screen.queryByText(RESOLUTION_META.consensus.label)).toBeNull();
  });

  test("невідоме значення resolution (поза RESOLUTION_META) — компонент падає при рендері", () => {
    const badEntry = entry(
      verdictRow({
        id: "s1",
        criterion_key: "1",
        resolution: "future_case" as SynthesisResolution,
      }),
      [],
    );
    expect(() => render(<VerdictDetails entry={badEntry} />)).toThrow();
  });
});

describe("VerdictDetails — оцінка синтезу (score)", () => {
  test("score заданий — рядок «Оцінка: <значення>» рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", score: "7/10" }), [])} />);
    expect(screen.getByText("7/10")).toBeDefined();
  });

  test("score=null — рядок з оцінкою не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", score: null }), [])} />);
    expect(screen.queryByText(/Оцінка:/)).toBeNull();
  });

  test("score='' (порожній рядок) — falsy, рядок з оцінкою не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", score: "" }), [])} />);
    expect(screen.queryByText(/Оцінка:/)).toBeNull();
  });

  test("score='0' (непорожній рядок-нуль) — truthy, рядок з оцінкою рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", score: "0" }), [])} />);
    expect(screen.getByText(/Оцінка:/)).toBeDefined();
  });
});

describe("VerdictDetails — деталі синтезу (detail, CollapsibleBody+Prose)", () => {
  test("detail заданий — розгорнутий текст рендериться", () => {
    render(
      <VerdictDetails
        entry={entry(verdictRow({ id: "s1", criterion_key: "1", detail: "детальний розбір критерію" }), [])}
      />,
    );
    expect(screen.getByText("детальний розбір критерію")).toBeDefined();
  });

  test("detail=null — розгорнутий блок не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", detail: null }), [])} />);
    expect(screen.queryByText("детальний розбір критерію")).toBeNull();
  });

  test("detail — довгий текст із markdown-розміткою рендериться повністю", () => {
    const long = "# Заголовок\n\n" + "абзац із **жирним** текстом. ".repeat(60);
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", detail: long }), [])} />);
    expect(screen.getByText(/абзац із/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Заголовок" })).toBeDefined();
  });
});

describe("VerdictDetails — докази (evidence з synthesis, а не з моделей)", () => {
  test("synthesis.evidence=null — жодного посилання не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", evidence: null }), [])} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("synthesis.evidence=[] — жодного посилання не рендериться", () => {
    render(<VerdictDetails entry={entry(verdictRow({ id: "s1", criterion_key: "1", evidence: [] }), [])} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("synthesis.evidence — один запис без дати й цитати — лише посилання", () => {
    render(
      <VerdictDetails
        entry={entry(
          verdictRow({ id: "s1", criterion_key: "1", evidence: [{ url: "https://a.example" }] }),
          [],
        )}
      />,
    );
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://a.example");
    expect(screen.queryByText("“", { exact: false })).toBeNull();
  });

  test("synthesis.evidence — запис з датою і цитатою — обидва рендеряться", () => {
    render(
      <VerdictDetails
        entry={entry(
          verdictRow({
            id: "s1",
            criterion_key: "1",
            evidence: [{ url: "https://a.example", published_date: "2026-02-01", quote: "пряма цитата джерела" }],
          }),
          [],
        )}
      />,
    );
    expect(screen.getByRole("link")).toBeDefined();
    expect(screen.getByText(/пряма цитата джерела/)).toBeDefined();
  });

  test("synthesis.evidence — кілька записів — усі посилання рендеряться", () => {
    render(
      <VerdictDetails
        entry={entry(
          verdictRow({
            id: "s1",
            criterion_key: "1",
            evidence: [{ url: "https://a.example" }, { url: "https://b.example" }],
          }),
          [],
        )}
      />,
    );
    const links = screen.getAllByRole("link") as HTMLAnchorElement[];
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://a.example", "https://b.example"]);
  });

  // synthesis=null — evidence береться лише з synthesis?.evidence, докази
  // окремих моделей (row.evidence) тут узагалі не читаються.
  test("synthesis=null (лише моделі з власним evidence) — докази моделей не рендеряться у VerdictDetails", () => {
    render(
      <VerdictDetails
        entry={entry(null, [
          verdictRow({
            id: "m1",
            criterion_key: "1",
            evidence: [{ url: "https://model-evidence.example" }],
          }),
        ])}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("VerdictDetails — синтез і моделі одночасно (взаємовиключні секції разом)", () => {
  test("synthesis і models обидва задані — пігулки моделей і резолюція синтезу рендеряться разом", () => {
    render(
      <VerdictDetails
        entry={entry(
          verdictRow({ id: "s1", criterion_key: "1", resolution: "consensus" }),
          [verdictRow({ id: "m1", criterion_key: "1", provider: "openai", verdict: "passed" })],
        )}
      />,
    );
    expect(screen.getByText(`openai: ${TONE_META.passed.label}`)).toBeDefined();
    expect(screen.getByText(RESOLUTION_META.consensus.label)).toBeDefined();
  });
});

describe("VerdictRowDetails — вердикт (обов'язкова пігулка)", () => {
  test.each(Object.keys(VERDICT_TONE) as CriterionVerdict[])(
    "verdict='%s' — пігулка з лейблом відповідного тону",
    (verdict) => {
      render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", verdict })} />);
      expect(screen.getByText(TONE_META[VERDICT_TONE[verdict]].label)).toBeDefined();
    },
  );

  test("невідоме значення verdict (поза словником CriterionVerdict) — компонент падає при рендері", () => {
    const badRow = verdictRow({ id: "r1", criterion_key: "1", verdict: "unexpected_verdict" as CriterionVerdict });
    expect(() => render(<VerdictRowDetails row={badRow} />)).toThrow();
  });
});

describe("VerdictRowDetails — оцінка (score)", () => {
  test("score заданий — рендериться", () => {
    render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", score: "9/10" })} />);
    expect(screen.getByText("9/10")).toBeDefined();
  });

  test("score=null — не рендериться", () => {
    render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", score: null })} />);
    expect(screen.queryByText(/Оцінка:/)).toBeNull();
  });
});

describe("VerdictRowDetails — короткий підсумок (summary)", () => {
  test("summary заданий — абзац рендериться", () => {
    render(
      <VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", summary: "короткий підсумок моделі" })} />,
    );
    expect(screen.getByText("короткий підсумок моделі")).toBeDefined();
  });

  test("summary=null — абзац не рендериться", () => {
    render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", summary: null })} />);
    expect(screen.queryByText("короткий підсумок моделі")).toBeNull();
  });
});

describe("VerdictRowDetails — деталі (detail, CollapsibleBody+Prose)", () => {
  test("detail заданий — розгорнутий текст рендериться", () => {
    render(
      <VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", detail: "розгорнутий розбір моделі" })} />,
    );
    expect(screen.getByText("розгорнутий розбір моделі")).toBeDefined();
  });

  test("detail=null — розгорнутий блок не рендериться", () => {
    render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", detail: null })} />);
    expect(screen.queryByText("розгорнутий розбір моделі")).toBeNull();
  });
});

describe("VerdictRowDetails — докази (evidence з рядка моделі)", () => {
  test("evidence=null — жодного посилання не рендериться", () => {
    render(<VerdictRowDetails row={verdictRow({ id: "r1", criterion_key: "1", evidence: null })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("evidence — запис з датою і цитатою — обидва рендеряться поруч з посиланням", () => {
    render(
      <VerdictRowDetails
        row={verdictRow({
          id: "r1",
          criterion_key: "1",
          evidence: [{ url: "https://row.example", published_date: "2026-03-01", quote: "цитата рядка моделі" }],
        })}
      />,
    );
    expect(screen.getByRole("link")).toBeDefined();
    expect(screen.getByText(/цитата рядка моделі/)).toBeDefined();
  });
});
