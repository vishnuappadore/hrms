"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { WalkInStatus } from "@keystonehr/shared";
import type { BadgeVariant } from "@/components/ui/badge";

/** Statuses shown as Board columns and the List's default sort — `cancelled`
 *  entries drop out of both views once cancelled (per docs/MODULES/pos.md). */
export const WALKIN_BOARD_STATUSES = ["waiting", "serving", "completed"] as const;

/** Shared between the List's status column and the details drawer's header badge. */
export const STATUS_BADGE: Record<WalkInStatus, BadgeVariant> = {
  waiting: "warning",
  serving: "info",
  completed: "success",
  cancelled: "destructive",
};

/** Live-updating "N min" wait display, ticking every 30s so the queue feels real-time
 *  without a per-second re-render. */
export function useElapsedMinutes(since: string | Date): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000));
}

export function useWaitLabel(since: string | Date): string {
  const t = useTranslations("walkIn");
  const minutes = useElapsedMinutes(since);
  return t("list.minutes", { minutes });
}

export function useServiceNames(services: { nameEn: string; nameAr: string }[]): string {
  const locale = useLocale();
  const names = services.map((s) => (locale === "ar" ? s.nameAr : s.nameEn));
  if (names.length === 0) return "—";
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]!;
}
