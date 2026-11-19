"use client";

import { useTranslations } from "next-intl";
import type { Branch, WalkIn } from "@keystonehr/shared";
import { Drawer } from "@/components/ui/drawer";
import { WalkInDetailView } from "./walk-in-detail-view";
import { WalkInForm } from "./walk-in-form";

export type WalkInDrawerState =
  | { mode: "create" }
  | { mode: "edit"; entry: WalkIn }
  | { mode: "view"; entry: WalkIn }
  | null;

export function WalkInDrawer({
  state,
  branch,
  onClose,
  onEdit,
}: {
  state: WalkInDrawerState;
  branch: Branch | undefined;
  onClose: () => void;
  onEdit: (entry: WalkIn) => void;
}) {
  const t = useTranslations("walkIn");
  const tc = useTranslations("common");

  const title =
    state?.mode === "edit"
      ? t("drawer.editTitle")
      : state?.mode === "view"
        ? t("drawer.viewTitle")
        : t("drawer.addTitle");

  return (
    <Drawer
      open={state !== null && !!branch}
      onClose={onClose}
      title={title}
      description={state === null || state.mode === "view" ? undefined : t("drawer.addSubtitle")}
      closeLabel={tc("close")}
      size="lg"
    >
      {!branch || state === null ? null : state.mode === "view" ? (
        <WalkInDetailView entry={state.entry} onEdit={() => onEdit(state.entry)} />
      ) : (
        <WalkInForm branch={branch} entry={state.mode === "edit" ? state.entry : undefined} onDone={onClose} />
      )}
    </Drawer>
  );
}
