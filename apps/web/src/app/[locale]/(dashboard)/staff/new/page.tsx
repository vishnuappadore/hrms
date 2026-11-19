import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import { StaffForm } from "../staff-form";

export default function NewStaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <NewStaffContent />;
}

function NewStaffContent() {
  const t = useTranslations("staff");
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("addUser")}</h1>
        <BackLink href="/staff" label={t("backToList")} bare />
      </div>
      <StaffForm />
    </div>
  );
}
