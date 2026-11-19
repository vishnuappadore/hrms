"use client";

import { useTranslations } from "next-intl";
import type { Customer } from "@keystonehr/shared";
import { Drawer } from "@/components/ui/drawer";
import { CustomerDetailView } from "./customer-detail-view";
import { CustomerForm } from "./customer-form";

export type CustomerDrawerState =
  | { mode: "create" }
  | { mode: "edit"; customer: Customer }
  | { mode: "view"; customer: Customer }
  | null;

export function CustomerDrawer({
  state,
  onClose,
  onEdit,
}: {
  state: CustomerDrawerState;
  onClose: () => void;
  /** Called when the View mode's Edit button is clicked — the caller owns the state, so it decides
   *  whether to switch this same open drawer into edit mode. */
  onEdit?: (customer: Customer) => void;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");

  const title =
    state?.mode === "edit" ? t("editTitle") : state?.mode === "view" ? t("viewTitle") : t("addTitle");

  return (
    <Drawer
      open={state !== null}
      onClose={onClose}
      title={title}
      description={state?.mode === "view" ? undefined : t("drawerSubtitle")}
      closeLabel={tc("close")}
      size="lg"
    >
      {state?.mode === "view" ? (
        <CustomerDetailView customer={state.customer} onEdit={() => onEdit?.(state.customer)} />
      ) : (
        <CustomerForm customer={state?.mode === "edit" ? state.customer : undefined} onDone={onClose} />
      )}
    </Drawer>
  );
}
