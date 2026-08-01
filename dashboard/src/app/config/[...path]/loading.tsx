import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Skeleton className="mb-4 h-3 w-56" />
      <Skeleton className="mb-6 h-7 w-72" />
      {/* max-w-[72ch] — та сама міра рядка, що й у .prose-doc. */}
      <div className="space-y-3 rounded-lg border border-line bg-paper-raised p-6">
        {Array.from({ length: 12 }).map((_, index) => (
          <Skeleton
            key={index}
            className={`h-3.5 max-w-[72ch] ${index % 4 === 3 ? "w-2/5" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
