import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { QueueContent } from "./queue-content";

export default function QueuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <QueueContent />;
}
