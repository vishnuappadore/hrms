"use client";

import { useTranslations } from "next-intl";
import { MyPanelWidget } from "./my-panel-widget";

export function DashboardContent() {
  const t = useTranslations("dashboard");

  return (
    <div>
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MyPanelWidget />
      </div>
    </div>
  );
}
