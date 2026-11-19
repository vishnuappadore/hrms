import type { CustomerTier } from "@keystonehr/shared";
import type { BadgeVariant } from "@/components/ui/badge";

export const TIER_BADGE_VARIANT: Record<CustomerTier, BadgeVariant> = {
  new: "info",
  bronze: "bronze",
  silver: "muted",
  gold: "warning",
  platinum: "platinum",
};
