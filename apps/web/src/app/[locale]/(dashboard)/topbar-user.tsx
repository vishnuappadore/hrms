"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/ui/avatar";
import { useMe } from "@/lib/queries/users";

/** Initials avatar + name for the signed-in user — links to the My Profile page. */
export function TopbarUser() {
  const t = useTranslations("profile");
  const locale = useLocale();
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <Link
      href="/profile"
      aria-label={t("openLabel")}
      className="flex items-center gap-2.5 rounded-lg transition hover:opacity-80"
    >
      <Avatar name={me.name} className="h-8 w-8 rounded-full" />
      <div className="hidden leading-tight sm:block">
        <p className="text-sm font-medium">{me.name}</p>
        <p className="text-xs text-muted-foreground">{locale === "ar" ? me.roleNameAr : me.roleNameEn}</p>
      </div>
    </Link>
  );
}
