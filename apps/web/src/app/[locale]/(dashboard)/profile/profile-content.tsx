"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useMe } from "@/lib/queries/employees";
import { MyLeavePanel } from "../leave/my-leave-panel";

const TABS = ["profile", "salary", "leave", "attendance", "notifications", "contactHq"] as const;
type ProfileTab = (typeof TABS)[number];

export function ProfileContent() {
  const t = useTranslations("profile");
  const locale = useLocale();
  const { data: me } = useMe();
  const [tab, setTab] = useState<ProfileTab>("leave");

  if (!me) return null;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      <div className="flex items-center gap-3">
        <Avatar name={me.name} />
        <p className="font-medium">{me.name}</p>
        <Badge>{locale === "ar" ? me.roleNameAr : me.roleNameEn}</Badge>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {TABS.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition",
              tab === tabKey ? "bg-primary-muted text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      {tab === "leave" ? (
        <MyLeavePanel />
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("comingSoon", { tab: t(`tabs.${tab}`) })}
        </p>
      )}
    </div>
  );
}
