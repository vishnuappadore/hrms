import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EditStaffContent } from "./edit-staff-content";

export default function EditStaffPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = use(params);
  setRequestLocale(locale);
  return <EditStaffContent userId={userId} />;
}
