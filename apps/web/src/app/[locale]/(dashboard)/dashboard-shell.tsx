"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandSwitcher } from "@/components/brand-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToastProvider } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { LogoutButton } from "./logout-button";
import { PageTitle } from "./page-title";
import { SidebarNav } from "./sidebar-nav";
import { TopbarUser } from "./topbar-user";

const STORAGE_KEY = "hr-sidebar-collapsed";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const tc = useTranslations("common");
  const [collapsed, setCollapsed] = useState(false);

  // Read the persisted state after mount — collapse is a minor layout
  // preference, not a full theme repaint, so a one-frame expand→collapse
  // flash for returning users is an acceptable trade-off (unlike brand/theme,
  // which use a pre-paint inline script to avoid any flash at all).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — sidebar stays expanded for this page */
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Brand sidebar — logical direction utilities only, so Arabic mirrors */}
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
            collapsed ? "w-[72px]" : "w-[230px]",
          )}
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b border-sidebar-border px-3",
              collapsed ? "justify-center px-0" : "justify-between",
            )}
          >
            {!collapsed && (
              <Image
                src="/logo.png"
                alt={tc("appName")}
                width={144}
                height={71}
                priority
                className="h-8 w-auto"
              />
            )}
            <button
              type="button"
              aria-label={tc(collapsed ? "expandSidebar" : "collapseSidebar")}
              title={tc(collapsed ? "expandSidebar" : "collapseSidebar")}
              onClick={toggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-muted-foreground transition hover:text-sidebar-foreground"
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <ChevronsLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          </div>
          <SidebarNav collapsed={collapsed} />
        </aside>

        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-5 backdrop-blur">
            <PageTitle />
            <div className="flex items-center gap-2.5">
              <LocaleSwitcher />
              <ThemeToggle />
              <BrandSwitcher />
              <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
              <TopbarUser />
              <LogoutButton label={tc("logout")} />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
