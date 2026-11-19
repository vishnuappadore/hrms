import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { LeaveSettingsContent } from "./leave-settings-content";

export default function LeaveSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <LeaveSettingsContent />;
}
