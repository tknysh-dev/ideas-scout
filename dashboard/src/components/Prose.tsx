import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Спільна типографіка прози для тіла ідеї (/ideas/[id]) і файлів конфігурації
// (/config/[...path]) — щоб обидві сторінки виглядали однаково і мали
// достатній контраст в обох темах (стилі прив'язані до наших CSS-змінних
// теми, а не до фіксованої палітри prose-neutral).
export default function Prose({ content }: { content: string }) {
  return (
    <div className="prose-doc">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
