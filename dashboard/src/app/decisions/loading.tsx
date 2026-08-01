import { SkeletonCard, SkeletonHeader } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <SkeletonHeader />
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonCard key={index} lines={2} />
        ))}
      </div>
    </div>
  );
}
