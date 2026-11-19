"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <LogOut className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
