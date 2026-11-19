"use client";

import { useLocale, useTranslations } from "next-intl";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useService } from "@/lib/queries/services";
import { ServiceForm } from "../service-form";

export function EditServiceContent({ serviceId }: { serviceId: string }) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: service, isLoading, isError } = useService(serviceId);

  if (isLoading) {
    return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-xl bg-muted" />;
  }
  if (isError || !service) {
    return <Alert>{tc("loadFailed")}</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="/settings/services" label={t("backToList")} />
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {locale === "ar" ? service.nameAr : service.nameEn}
        </h1>
        <Badge variant={service.status === "active" ? "success" : "destructive"}>
          {tc(service.status)}
        </Badge>
      </div>
      <ServiceForm service={service} />
    </div>
  );
}
