import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import { BranchForm } from "../branch-form";

export default function NewBranchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <NewBranchContent />;
}

function NewBranchContent() {
  const t = useTranslations("branches");
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("addBranch")}</h1>
        <BackLink href="/branches" label={t("backToList")} bare />
      </div>
      <BranchForm />
    </div>
  );
}
