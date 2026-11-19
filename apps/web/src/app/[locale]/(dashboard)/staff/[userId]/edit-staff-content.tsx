"use client";

import { useLocale, useTranslations } from "next-intl";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/lib/queries/users";
import { StaffForm } from "../staff-form";

export function EditStaffContent({ userId }: { userId: string }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: user, isLoading, isError } = useUser(userId);

  if (isLoading) {
    return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-muted" />;
  }
  if (isError || !user) {
    return <Alert>{tc("loadFailed")}</Alert>;
  }

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{user.name}</h1>
          <span className="text-sm text-muted-foreground">@{user.username}</span>
          <Badge variant={user.status === "active" ? "success" : "destructive"}>
            {tc(user.status)}
          </Badge>
        </div>
        <BackLink href="/staff" label={t("backToList")} bare />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        {t("audit.created", { date: dateFmt.format(new Date(user.createdAt)) })}
        {" · "}
        {t("audit.updated", { date: dateFmt.format(new Date(user.updatedAt)) })}
      </p>
      <StaffForm user={user} />
    </div>
  );
}
