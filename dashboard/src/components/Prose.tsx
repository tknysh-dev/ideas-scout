import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import IdeaRefPill from "@/components/IdeaRefPill";
import type { IdeaRef } from "@/lib/idea-refs";
import rehypeIdeaRefs from "@/lib/rehype-idea-refs";

// Спільна типографіка прози для тіла ідеї (/ideas/[id]) і файлів конфігурації
// (/config/[...path]) — щоб обидві сторінки виглядали однаково і мали
// достатній контраст в обох темах (стилі прив'язані до наших CSS-змінних
// теми, а не до фіксованої палітри prose-neutral).
export default function Prose({
  content,
  ideaRefs,
}: {
  content: string;
  ideaRefs?: Record<string, IdeaRef>;
}) {
  const refs = ideaRefs && Object.keys(ideaRefs).length > 0 ? ideaRefs : null;

  return (
    <div className="prose-doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={refs ? [rehypeIdeaRefs(new Set(Object.keys(refs)))] : []}
        components={
          refs
            ? ({
                idearef: ({ "data-idea-id": id }: { "data-idea-id"?: string }) => {
                  const idea = id ? refs[id] : undefined;
                  return idea ? <IdeaRefPill idea={idea} /> : null;
                },
              } as unknown as Components)
            : undefined
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
