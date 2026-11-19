"use client";

import { useTranslations } from "next-intl";
import {
  Bell,
  Building2,
  CalendarClock,
  CalendarOff,
  Gift,
  ReceiptText,
  Scissors,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/permissions";

/* `requiredPermission` matches each section's actual read-gate on the API, confirmed per
   controller — not a blanket "settings.manage" (Payroll Components reads via `staff.view`, Leave
   Settings via `leave.request`, both intentionally broader than an admin-only key since any staff
   member who can use those flows can also read their configuration). Sections with no `href` are
   unbuilt "coming soon" placeholders — nothing to gate. */
const SECTIONS: { key: string; href?: string; requiredPermission?: string; icon: LucideIcon }[] = [
  { key: "services", href: "/settings/services", requiredPermission: "services.view", icon: Scissors },
  { key: "payroll", href: "/settings/payroll-components", requiredPermission: "staff.view", icon: Wallet },
  { key: "leave", href: "/settings/leave-settings", requiredPermission: "leave.request", icon: CalendarOff },
  { key: "general", href: "/settings/general", requiredPermission: "settings.general.manage", icon: SlidersHorizontal },
  { key: "company", href: "/settings/company", requiredPermission: "settings.company.manage", icon: Building2 },
  { key: "loyalty", icon: Gift },
  { key: "appointments", icon: CalendarClock },
  { key: "taxes", icon: ReceiptText },
  { key: "notifications", icon: Bell },
];

export function SettingsContent() {
  const t = useTranslations("settings");
  const permissions = usePermissions();

  const visibleSections = SECTIONS.filter(
    (section) => !section.requiredPermission || permissions.includes(section.requiredPermission),
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleSections.map(({ key, href, icon: Icon }) => {
          const body = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {t(`sections.${key}.title`)}
                  {!href && <Badge variant="muted">{t("comingSoon")}</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(`sections.${key}.description`)}
                </span>
              </span>
            </>
          );
          return href ? (
            <Link
              key={key}
              href={href}
              className="flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-ring/40 hover:bg-muted/40"
            >
              {body}
            </Link>
          ) : (
            <div
              key={key}
              className="flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 opacity-70"
            >
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
