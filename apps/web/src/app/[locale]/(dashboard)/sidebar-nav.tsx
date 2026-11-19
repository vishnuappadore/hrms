"use client";

import {
  Banknote,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  Footprints,
  Gift,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";

type NavKey =
  | "dashboard"
  | "appointments"
  | "pos"
  | "walkInQueue"
  | "customers"
  | "loyalty"
  | "staff"
  | "attendance"
  | "leave"
  | "payroll"
  | "inventory"
  | "branches"
  | "reports"
  | "roles"
  | "settings";

type NavSection = "operations" | "people" | "business" | "administration";

type NavGroup = {
  section: NavSection;
  items: { key: NavKey; href: string; requiredPermission?: string }[];
};

/* Nav grouped into labelled sections (matches the approved claude.ai console design).
   Order is preserved; NAV_ITEMS below is derived from this for the topbar title.
   `requiredPermission` is only set where a real, enforced permission key exists for the page
   behind it — items for unbuilt features (dashboard/loyalty/reports) have none and stay
   unconditionally visible; that's a feature-completeness gap, not a permission one. */
export const NAV_GROUPS: NavGroup[] = [
  {
    section: "operations",
    items: [
      { key: "dashboard", href: "/dashboard" },
      { key: "appointments", href: "/appointments", requiredPermission: "appointments.view" },
      { key: "pos", href: "/pos", requiredPermission: "pos.use" },
      { key: "walkInQueue", href: "/queue", requiredPermission: "walkin.view" },
      { key: "customers", href: "/customers", requiredPermission: "customers.view" },
      { key: "loyalty", href: "/loyalty" },
    ],
  },
  {
    section: "people",
    items: [
      { key: "staff", href: "/staff", requiredPermission: "staff.view" },
      { key: "attendance", href: "/attendance", requiredPermission: "attendance.view" },
      { key: "leave", href: "/leave", requiredPermission: "leave.view" },
      { key: "payroll", href: "/payroll", requiredPermission: "payroll.view" },
    ],
  },
  {
    section: "business",
    items: [
      { key: "inventory", href: "/inventory", requiredPermission: "inventory.view" },
      { key: "branches", href: "/branches", requiredPermission: "branches.view" },
      { key: "reports", href: "/reports" },
    ],
  },
  {
    section: "administration",
    items: [
      // was "/roles" — that route never existed; the real page is under Settings.
      { key: "roles", href: "/settings/roles", requiredPermission: "roles.manage" },
      { key: "settings", href: "/settings" },
    ],
  },
];

/** Flat list of every nav item — consumed by page-title.tsx to label the topbar. */
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The single most-specific nav item matching the current path — picks the longest href match
 * rather than every prefix match, so a nested route (e.g. /settings/roles) doesn't also light up
 * its parent (/settings).
 */
export function findActiveNavKey(pathname: string): NavKey | undefined {
  let best: { key: NavKey; href: string } | undefined;
  for (const item of NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.key;
}

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  appointments: CalendarDays,
  pos: ShoppingCart,
  walkInQueue: Footprints,
  customers: Users,
  loyalty: Gift,
  staff: UserCog,
  attendance: CalendarCheck,
  leave: CalendarOff,
  payroll: Banknote,
  inventory: Package,
  branches: Store,
  reports: BarChart3,
  roles: ShieldCheck,
  settings: Settings,
};

export function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname(); // locale-stripped, e.g. /branches/new
  const permissions = usePermissions();
  const activeKey = findActiveNavKey(pathname);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.requiredPermission || permissions.includes(item.requiredPermission),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
      {visibleGroups.map((group) => (
        <div key={group.section} className="space-y-1">
          {!collapsed && (
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[.6px] text-sidebar-section-foreground">
              {t(`sections.${group.section}`)}
            </div>
          )}
          {group.items.map((item) => {
            const Icon = ICONS[item.key];
            const active = item.key === activeKey;
            return (
              <Link
                key={item.key}
                href={item.href}
                title={collapsed ? t(item.key) : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg py-2.5 text-[13px] transition-colors",
                  collapsed ? "justify-center px-0" : "px-3",
                  active
                    ? "bg-primary/12 font-medium text-sidebar-foreground"
                    : "text-sidebar-nav-foreground hover:bg-sidebar-foreground/[0.06] hover:text-sidebar-foreground",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", active && "text-primary")}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {!collapsed && t(item.key)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
