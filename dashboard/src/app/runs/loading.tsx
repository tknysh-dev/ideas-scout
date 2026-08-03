import { Skeleton, SkeletonHeader, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <SkeletonHeader />
      <div className="mb-5 flex gap-6 border-b border-line pb-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-36" />
      </div>
      {/* Колонки черги M1: створено, тип, статус, спроба, worker, run id. */}
      <SkeletonRows rows={10} columns={[7, 9, 5, 3, 10, 13]} />
    </div>
  );
}
