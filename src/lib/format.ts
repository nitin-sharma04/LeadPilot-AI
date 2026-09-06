export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function formatRelativeDay(date: string): string {
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(target);
  compare.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (compare.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return formatDate(date);
}

export function getScoreTier(score: number): "hot" | "warm" | "cold" {
  if (score >= 90) return "hot";
  if (score >= 70) return "warm";
  return "cold";
}

export function getScoreLabel(score: number): string {
  const tier = getScoreTier(score);
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
