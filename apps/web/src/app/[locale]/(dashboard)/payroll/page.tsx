import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PayrollContent } from "./payroll-content";

export default function PayrollPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <PayrollContent />;
}
