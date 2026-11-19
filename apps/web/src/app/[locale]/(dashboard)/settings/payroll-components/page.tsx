import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PayrollComponentsContent } from "./payroll-components-content";

export default function PayrollComponentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <PayrollComponentsContent />;
}
