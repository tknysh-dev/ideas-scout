import ArchitectureDiagram from "@/components/ArchitectureDiagram";

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          як це працює
        </p>
        <h1 className="font-display text-3xl text-ink">Архітектура</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-dim">
          Повний шлях сигналу: від поста в інтернеті чи повідомлення в Telegram — через
          агентів на Mac і базу — до рішення, яке ухвалюєш ти. Клацни на будь-який блок,
          щоб побачити пояснення, а для конфігураційних файлів — і їхній повний вміст.
        </p>
      </header>

      <ArchitectureDiagram />
    </div>
  );
}
