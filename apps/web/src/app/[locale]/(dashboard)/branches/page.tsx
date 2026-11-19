import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BranchesContent } from "./branches-content";

export default function BranchesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <BranchesContent />;
}
