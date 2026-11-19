import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { GeneralContent } from "./general-content";

export default function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <GeneralContent />;
}
