import "server-only";
import { readConfigFile } from "@/lib/config-files";
import {
  DEEP_CRITERIA_DOC_PATH,
  HANDOFF_TEMPLATE_PATH,
  criteriaDocPath,
  isResearchableTrack,
  renderHandoffPrompt,
  type IdeaContextInput,
  type SourceContextInput,
} from "@/lib/deep-research-prompt";
import { OWNER_DECIDABLE_STATUSES } from "@/lib/status";
import { getServiceClient } from "@/lib/supabase/service";
import type { IdeaStatus } from "@/lib/types";

export type DeepResearchPromptResult = { prompt: string } | { error: string };

const IDEA_FIELDS =
  "id,title,type,track,status,signal_type,claimed_revenue,mechanic_summary,monetization_hypothesis,body";

// Промпт збирається на сервері з тих самих файлів репозиторію, які показує
// сторінка /config: локально — з робочої копії, у проді — з GitHub. Одна ідея,
// один текст; ділити його на N вікон моделей — робота власника, не коду.
export interface ResearcherLabels {
  researcher?: string;
  researcherModel?: string;
}

export async function buildDeepResearchPrompt(
  ideaId: string,
  labels: ResearcherLabels = {},
  today = new Date().toISOString().slice(0, 10),
): Promise<DeepResearchPromptResult> {
  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  const { data: idea, error } = await supabase
    .from("ideas")
    .select(IDEA_FIELDS)
    .eq("id", ideaId)
    .maybeSingle<IdeaContextInput & { status: IdeaStatus }>();
  if (error) return { error: `Не вдалося прочитати ідею: ${error.message}` };
  if (!idea) return { error: "Ідею не знайдено." };
  if (!OWNER_DECIDABLE_STATUSES.includes(idea.status)) {
    return { error: "Глибоке дослідження доступне після первинної оцінки ідеї." };
  }
  if (!isResearchableTrack(idea.track)) {
    return { error: `Трек «${idea.track}» не має чек-листа критеріїв.` };
  }

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("url,published_date,author_interest")
    .eq("idea_id", ideaId)
    .order("id", { ascending: true })
    .returns<SourceContextInput[]>();
  if (sourcesError) return { error: `Не вдалося прочитати джерела: ${sourcesError.message}` };

  try {
    const [template, criteriaDoc, deepDoc] = await Promise.all([
      readConfigFile(HANDOFF_TEMPLATE_PATH),
      readConfigFile(criteriaDocPath(idea.track)),
      readConfigFile(DEEP_CRITERIA_DOC_PATH),
    ]);
    return {
      prompt: renderHandoffPrompt({
        idea,
        sources: sources ?? [],
        template: template.content,
        criteriaDoc: criteriaDoc.content,
        deepDoc: deepDoc.content,
        today,
        researcher: labels.researcher,
        researcherModel: labels.researcherModel,
      }),
    };
  } catch (readError) {
    const message = readError instanceof Error ? readError.message : String(readError);
    return { error: `Не вдалося прочитати шаблон промпта: ${message}` };
  }
}
