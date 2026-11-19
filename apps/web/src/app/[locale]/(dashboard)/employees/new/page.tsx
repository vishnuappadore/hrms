import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BackLink } from "@/components/back-link";
import { EmployeeForm } from "../employee-form";

export default function NewEmployeePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <NewEmployeeContent />;
}

function NewEmployeeContent() {
  const t = useTranslations("employees");
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("addUser")}</h1>
        <BackLink href="/employees" label={t("backToList")} bare />
      </div>
      <EmployeeForm />
    </div>
  );
}
