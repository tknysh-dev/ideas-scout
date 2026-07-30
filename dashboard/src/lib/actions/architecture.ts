"use server";

import { ARCH_NODES } from "@/lib/architecture";
import { readConfigFile } from "@/lib/config-files";

export interface ArchDocResult {
  content: string | null;
  changed: string | null;
  error: string | null;
}

// Поп-ап діаграми просить вміст файлу за ключем вузла, а не за шляхом: так
// клієнт не може попросити довільний файл навіть у межах дозволених директорій.
export async function loadArchDoc(nodeKey: string): Promise<ArchDocResult> {
  const doc = ARCH_NODES[nodeKey]?.doc;
  if (!doc) return { content: null, changed: null, error: null };

  try {
    const file = await readConfigFile(doc);
    return { content: file.content, changed: file.changed, error: null };
  } catch (err) {
    return {
      content: null,
      changed: null,
      error: err instanceof Error ? err.message : "Невідома помилка",
    };
  }
}
