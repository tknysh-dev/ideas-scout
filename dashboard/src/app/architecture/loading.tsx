import { Skeleton, SkeletonHeader } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <SkeletonHeader />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}
