import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <Skeleton className="mb-6 h-3 w-48" />
      <Skeleton className="h-5 w-40 rounded-full" />
      <Skeleton className="mt-3 h-9 w-3/4" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />

      <div className="mt-8 grid gap-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-line bg-paper-raised p-5">
            <Skeleton className="h-3 w-28" />
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
