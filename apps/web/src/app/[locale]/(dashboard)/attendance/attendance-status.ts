/** Shared Badge variant mapping for AttendanceDayStatus — one color per status, reused by every Attendance screen/dialog. */
export const STATUS_BADGE_VARIANT = {
  present: "success",
  late: "warning",
  on_leave: "info",
  absent: "destructive",
  weekly_off: "muted",
  pending: "muted",
  holiday: "muted",
} as const;
