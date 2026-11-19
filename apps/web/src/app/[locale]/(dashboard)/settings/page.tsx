import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { SettingsContent } from "./settings-content";

export default function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <SettingsContent />;
}
