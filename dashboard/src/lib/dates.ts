// Сервер (Vercel) живе в UTC, тому пояс задаємо явно — інакше час у
// дашборді "їде" відносно очікувань власника. Змінюється через NEXT_PUBLIC_TZ.
const TIME_ZONE = process.env.NEXT_PUBLIC_TZ ?? "Europe/Warsaw";

type MonthStyle = "short" | "long";

export function formatDate(
  value: string | null,
  month: MonthStyle = "short",
  fallback = "—",
) {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString("uk-UA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month,
    day: "numeric",
  });
}

export function formatDateTime(
  value: string | null,
  month: MonthStyle = "short",
  fallback = "—",
) {
  if (!value) return fallback;
  return new Date(value).toLocaleString("uk-UA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month,
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
