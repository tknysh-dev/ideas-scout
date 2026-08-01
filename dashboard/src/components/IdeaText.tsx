import { resolveIdeaRefs } from "@/lib/idea-refs.server";
import { linkify } from "@/lib/linkify";

// Той самий розбір id, що й у <Card>, але для готового рядка — там, де текст
// приходить масивом даних, а не JSX (комірки таблиць).
export default async function IdeaText({
  text,
  exclude,
}: {
  text: string;
  exclude?: string;
}) {
  const refs = await resolveIdeaRefs([text], exclude);
  return <>{Object.keys(refs).length > 0 ? linkify(text, refs) : text}</>;
}
