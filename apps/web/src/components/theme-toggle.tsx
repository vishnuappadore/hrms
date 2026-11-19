"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";

export function ThemeToggle() {
  const t = useTranslations("common");
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label={t("toggleTheme")}
      title={t("toggleTheme")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {/* Icons swap via CSS only — no mounted guard, no hydration mismatch */}
      <Sun className="h-4 w-4 dark:hidden" strokeWidth={1.75} aria-hidden="true" />
      <Moon className="hidden h-4 w-4 dark:block" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
