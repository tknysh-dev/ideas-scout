import { Reveal } from "@/components/motion";
import { resolveIdeaRefs } from "@/lib/idea-refs.server";
import { collectText, linkify } from "@/lib/linkify";

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
} as const;

// Єдина картка порталу. Крім оформлення й появи вона робить головне: сама
// розбирає будь-який текст, що в неї потрапив, і замінює згадки id ідей на
// пігулку з тултіпом. Тому нову картку не треба окремо навчати посиланням —
// достатньо загорнути вміст у <Card>.
export default async function Card({
  as = "div",
  index = 0,
  padding = "md",
  accent = false,
  // Блок, якому потрібен лише розбір тексту й поява, без рамки й підкладки —
  // хронологія подій, наприклад, малюється власною лінією часу.
  plain = false,
  className = "",
  exclude,
  children,
}: {
  as?: "div" | "li" | "section";
  index?: number;
  padding?: keyof typeof PADDING;
  accent?: boolean;
  plain?: boolean;
  className?: string;
  /** id самої картки — себе посиланням не робимо. */
  exclude?: string;
  children: React.ReactNode;
}) {
  const texts: string[] = [];
  collectText(children, texts);
  const refs = await resolveIdeaRefs(texts, exclude);

  const shell = plain
    ? ""
    : `rounded-lg bg-paper-raised ${PADDING[padding]} ${
        accent ? "border-2 border-accent" : "border border-line"
      }`;

  return (
    <Reveal as={as} index={index} className={`${shell} ${className}`.trim()}>
      {Object.keys(refs).length > 0 ? linkify(children, refs) : children}
    </Reveal>
  );
}
