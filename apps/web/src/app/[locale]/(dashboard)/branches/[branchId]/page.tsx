import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EditBranchContent } from "./edit-branch-content";

export default function EditBranchPage({
  params,
}: {
  params: Promise<{ locale: string; branchId: string }>;
}) {
  const { locale, branchId } = use(params);
  setRequestLocale(locale);
  return <EditBranchContent branchId={branchId} />;
}
