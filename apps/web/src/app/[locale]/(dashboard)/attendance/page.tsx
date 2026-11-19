import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AttendanceContent } from "./attendance-content";

export default function AttendancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <AttendanceContent />;
}
