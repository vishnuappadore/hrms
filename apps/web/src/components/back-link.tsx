import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/** Breadcrumb-style back link; arrow points to the logical start, flips in RTL. */
export function BackLink({
  href,
  label,
  bare = false,
}: {
  href: string;
  label: string;
  /** Omit the default bottom margin, e.g. when placed inline within a header row. */
  bare?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground",
        !bare && "mb-4",
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}
