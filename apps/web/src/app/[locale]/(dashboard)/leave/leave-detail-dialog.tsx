"use client";

import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, CircleX, Clock, Paperclip, RotateCcw } from "lucide-react";
import type { LeaveRequestDetail } from "@keystonehr/shared";
import { usePermissions } from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatTile } from "@/components/ui/stat-tile";
import { TimelineRow } from "@/components/ui/timeline";
import { useLeaveAttachmentUrl, useLeaveRequestDetail } from "@/lib/queries/leave";
import { formatDateTime, periodLabel } from "./leave-format";
import { LEAVE_STATUS_BADGE_VARIANT } from "./leave-status";

const HISTORY_LABEL_KEYS: Record<string, string> = {
  "leave_request.created": "applied",
  "leave_request.first_approved": "firstApproved",
  "leave_request.approved": "approved",
  "leave_request.rejected": "rejected",
  "leave_request.cancelled": "cancelled",
};

const HISTORY_ICONS: Record<string, typeof Clock> = {
  "leave_request.created": Clock,
  "leave_request.first_approved": CircleCheck,
  "leave_request.approved": CircleCheck,
  "leave_request.rejected": CircleX,
  "leave_request.cancelled": RotateCcw,
};

const HISTORY_ICON_CLASS: Record<string, string> = {
  "leave_request.created": "text-muted-foreground",
  "leave_request.first_approved": "text-primary",
  "leave_request.approved": "text-primary",
  "leave_request.rejected": "text-destructive",
  "leave_request.cancelled": "text-destructive",
};

export function LeaveDetailDialog({
  id,
  onClose,
  onApprove,
  onReject,
  onCancel,
  onWithdraw,
  mode = "approver",
}: {
  id: string | null;
  onClose: () => void;
  /** required in the default "approver" mode */
  onApprove?: (request: LeaveRequestDetail) => void;
  /** required in the default "approver" mode */
  onReject?: (request: LeaveRequestDetail) => void;
  /** required in the default "approver" mode */
  onCancel?: (request: LeaveRequestDetail) => void;
  /** required in "owner" mode */
  onWithdraw?: (request: LeaveRequestDetail) => void;
  /** "approver" (default): Approve/Reject on pending, Cancel on approved — the manager table's use.
   *  "owner": a single Cancel on pending-ish rows only — the viewer's own "My Leave" panel. */
  mode?: "approver" | "owner";
}) {
  const t = useTranslations("leave.detailDialog");
  const tStatus = useTranslations("leave.status");
  const tActions = useTranslations("leave.actions");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, isLoading } = useLeaveRequestDetail(id ?? undefined);
  const attachmentUrl = useLeaveAttachmentUrl();
  const permissions = usePermissions();

  async function openAttachment() {
    if (!id) return;
    const { url } = await attachmentUrl.mutateAsync(id);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const isPendingIsh = data?.status === "pending" || data?.status === "pending_second_approval";
  const isApproved = data?.status === "approved";

  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      title={data ? t("title", { name: data.employee.name }) : t("titleFallback")}
      className="max-w-2xl"
      showCloseButton
      closeLabel={tc("close")}
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={data.employee.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{data.employee.name}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{data.employee.role ?? "—"}</p>
            </div>
            <Badge variant={LEAVE_STATUS_BADGE_VARIANT[data.status]}>
              {data.status === "pending_second_approval" ? tStatus("pendingSecondApproval") : tStatus(data.status)}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              variant="compact"
              label={t("type")}
              value={locale === "ar" ? data.leaveType.nameAr : data.leaveType.nameEn}
            />
            <StatTile variant="compact" label={t("period")} value={periodLabel(data, locale, t)} />
            <StatTile variant="compact" label={t("days")} value={String(data.daysCount)} />
          </div>

          <div>
            <p className="mb-1 text-[10.5px] font-medium text-muted-foreground">{t("reason")}</p>
            <p className="text-sm">{data.reason ?? "—"}</p>
          </div>

          {data.attachmentKey && (
            <Button type="button" variant="outline" size="sm" onClick={openAttachment} disabled={attachmentUrl.isPending}>
              <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
              {attachmentUrl.isPending ? tc("loading") : t("viewAttachment")}
            </Button>
          )}

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-[10.5px] font-medium text-muted-foreground">{t("historyTitle")}</p>
            <div>
              {data.history.map((entry, i) => {
                const key = HISTORY_LABEL_KEYS[entry.action] ?? entry.action;
                const name = entry.actorName ?? t("unknownActor");
                return (
                  <TimelineRow
                    key={i}
                    icon={HISTORY_ICONS[entry.action] ?? Clock}
                    iconClassName={HISTORY_ICON_CLASS[entry.action] ?? "text-muted-foreground"}
                    label={t(`history.${key}`, { name })}
                    timestamp={formatDateTime(entry.at, locale)}
                    note={entry.note ?? undefined}
                    isLast={i === data.history.length - 1}
                  />
                );
              })}
            </div>
          </div>

          {mode === "owner" ? (
            isPendingIsh && (
              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <Button variant="destructive" onClick={() => onWithdraw?.(data)}>
                  {tActions("cancel")}
                </Button>
              </div>
            )
          ) : (
            <>
              {(isPendingIsh || isApproved) && permissions.includes("leave.approve") && (
                <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                  {isPendingIsh && (
                    <>
                      <Button variant="destructive" onClick={() => onReject?.(data)}>
                        {tActions("reject")}
                      </Button>
                      <Button onClick={() => onApprove?.(data)}>{tActions("approve")}</Button>
                    </>
                  )}
                  {isApproved && (
                    <Button variant="destructive" onClick={() => onCancel?.(data)}>
                      {tActions("cancel")}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
