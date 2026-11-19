import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EditEmployeeContent } from "./edit-employee-content";

export default function EditEmployeePage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = use(params);
  setRequestLocale(locale);
  return <EditEmployeeContent userId={userId} />;
}
