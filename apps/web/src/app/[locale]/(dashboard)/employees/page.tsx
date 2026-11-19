import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EmployeeContent } from "./employee-content";

export default function EmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <EmployeeContent />;
}
