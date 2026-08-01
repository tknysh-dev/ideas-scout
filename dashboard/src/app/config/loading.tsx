import { SkeletonHeader, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <SkeletonHeader />
      {/* Список файлів: назва файлу і шлях. */}
      <div className="space-y-6">
        <SkeletonRows rows={4} columns={[9, 16]} />
        <SkeletonRows rows={5} columns={[9, 16]} />
      </div>
    </div>
  );
}
