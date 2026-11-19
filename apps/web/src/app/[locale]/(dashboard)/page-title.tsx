"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { findActiveNavKey, NAV_ITEMS } from "./sidebar-nav";

/**
 * Topbar label for the current section, derived from the pathname. Always renders the `<span>`
 * (even empty) rather than `null` — the header is `justify-between` with this as its first of two
 * flex children, and with only one child `justify-between` collapses it to the start instead of
 * pushing the other (locale/theme/user/logout) group to the end.
 */
export function PageTitle() {
  const t = useTranslations("nav");
  const tProfile = useTranslations("profile");
  const pathname = usePathname();
  const activeKey = findActiveNavKey(pathname);
  const item = NAV_ITEMS.find((i) => i.key === activeKey);
  const label = item ? t(item.key) : pathname.startsWith("/profile") ? tProfile("title") : "";
  return <span className="text-sm font-semibold">{label}</span>;
}
