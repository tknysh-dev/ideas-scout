import { SkeletonCard, SkeletonHeader } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <SkeletonHeader />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} lines={3} />
        ))}
      </div>
    </div>
  );
}
