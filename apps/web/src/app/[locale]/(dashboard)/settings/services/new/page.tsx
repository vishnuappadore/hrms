import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import { ServiceForm } from "../service-form";

export default function NewServicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <NewServiceContent />;
}

function NewServiceContent() {
  const t = useTranslations("services");
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="/settings/services" label={t("backToList")} />
      <h1 className="mb-6 text-xl font-semibold">{t("addService")}</h1>
      <ServiceForm />
    </div>
  );
}
