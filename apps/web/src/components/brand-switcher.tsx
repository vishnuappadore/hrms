"use client";

import { SwatchBook } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Toggles the brand palette (green default ↔ gold) via data-brand on <html>,
 * persisted in localStorage; a head inline script re-applies it before paint.
 * The indicator dot uses the `primary` token, so it always shows the ACTIVE
 * brand without any JS state — no hydration mismatch, no mounted guard.
 */
export function BrandSwitcher() {
  const t = useTranslations("common");

  function toggleBrand() {
    const root = document.documentElement;
    const next = root.getAttribute("data-brand") === "gold" ? null : "gold";
    try {
      if (next) {
        root.setAttribute("data-brand", next);
        localStorage.setItem("hr-brand", next);
      } else {
        root.removeAttribute("data-brand");
        localStorage.removeItem("hr-brand");
      }
    } catch {
      /* storage unavailable — attribute still applies for this page */
    }
  }

  return (
    <button
      type="button"
      aria-label={t("changeBrand")}
      title={t("changeBrand")}
      onClick={toggleBrand}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <SwatchBook className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      <span
        aria-hidden="true"
        className="absolute bottom-1 end-1 h-1.5 w-1.5 rounded-full bg-primary"
      />
    </button>
  );
}
