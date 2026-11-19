import type { LeaveRequestStatus } from "@keystonehr/shared";

/** Badge color per request status — shared between the list table and any future detail view. */
export const LEAVE_STATUS_BADGE_VARIANT: Record<LeaveRequestStatus, "success" | "muted" | "destructive" | "warning"> = {
  pending: "warning",
  pending_second_approval: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "muted",
};
