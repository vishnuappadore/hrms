import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { LeaveContent } from "./leave-content";

export default function LeavePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <LeaveContent />;
}
