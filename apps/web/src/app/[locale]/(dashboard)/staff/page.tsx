import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { StaffContent } from "./staff-content";

export default function StaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <StaffContent />;
}
