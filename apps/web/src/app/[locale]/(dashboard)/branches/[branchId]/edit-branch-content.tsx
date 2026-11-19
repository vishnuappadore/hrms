"use client";

import { useLocale, useTranslations } from "next-intl";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useBranch } from "@/lib/queries/branches";
import { BranchForm } from "../branch-form";

export function EditBranchContent({ branchId }: { branchId: string }) {
  const t = useTranslations("branches");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: branch, isLoading, isError } = useBranch(branchId);

  if (isLoading) {
    return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-muted" />;
  }
  if (isError || !branch) {
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
          <h1 className="text-xl font-semibold">
            {locale === "ar" ? branch.nameAr : branch.nameEn}
          </h1>
          <span className="text-sm text-muted-foreground">{branch.code}</span>
          <Badge variant={branch.status === "active" ? "success" : "destructive"}>
            {tc(branch.status)}
          </Badge>
        </div>
        <BackLink href="/branches" label={t("backToList")} bare />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        {t("audit.created", { date: dateFmt.format(new Date(branch.createdAt)) })}
        {" · "}
        {t("audit.updated", { date: dateFmt.format(new Date(branch.updatedAt)) })}
      </p>
      <BranchForm branch={branch} />
    </div>
  );
}
