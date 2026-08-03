import { Skeleton, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <Skeleton className="mb-6 h-8 w-56" />
      <div className="flex gap-6 border-b border-line pb-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex gap-4 py-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>
      {/* Колонки дерева знахідок: id, назва, статус, код відмови, впевненість,
          заявлений дохід, дата. */}
      <SkeletonRows rows={10} columns={[5, 20, 6, 9, 6, 8, 6]} />
    </div>
  );
}
