import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { DashboardContent } from "./dashboard-content";

export default function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <DashboardContent />;
}
