import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { CompanyContent } from "./company-content";

export default function CompanySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <CompanyContent />;
}
