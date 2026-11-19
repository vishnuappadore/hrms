"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { LoginSchema } from "@keystonehr/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginFormProps {
  demo: { identifier: string; password: string } | null;
}

export function LoginForm({ demo }: LoginFormProps) {
  const t = useTranslations("login");
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const parsed = LoginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setError(t("errors.VALIDATION_FAILED"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body.code as string | undefined;
        setError(
          code === "INVALID_CREDENTIALS" || code === "ACCOUNT_INACTIVE"
            ? t(`errors.${code}`)
            : t("errors.NETWORK"),
        );
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(t("errors.NETWORK"));
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    if (!demo) return;
    setIdentifier(demo.identifier);
    setPassword(demo.password);
    setShowPassword(true);
    setError(null);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <div>
          <label htmlFor="identifier" className="mb-2 block text-xs font-medium text-muted-foreground">
            {t("identifier")}
          </label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            placeholder={t("identifierPlaceholder")}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setError(null);
            }}
            className="h-11 rounded-[10px]"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
              {t("password")}
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {showPassword ? t("hide") : t("show")}
            </button>
          </div>
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            className="h-11 rounded-[10px]"
          />
        </div>

        <div className="-mt-1 flex justify-end">
          <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            {t("forgotPassword")}
          </Link>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
          >
            <AlertTriangle className="h-4 w-4 flex-none" strokeWidth={1.75} aria-hidden="true" />
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="h-11 w-full rounded-[10px] bg-linear-to-br from-primary-hover to-primary text-sm font-semibold shadow-lg shadow-primary/25"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
          {submitting ? t("signingIn") : t("signIn")}
        </Button>
      </form>

      {demo && (
        <button
          type="button"
          onClick={fillDemo}
          className="mt-6 flex w-full items-center justify-between gap-3 rounded-[10px] border border-dashed border-primary/40 bg-card px-4 py-3 text-start transition hover:border-primary/70"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t("demoLabel")}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {demo.identifier} · {demo.password}
            </span>
          </span>
          <span className="flex-none rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {t("demoUse")}
          </span>
        </button>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("needHelp")} <span className="font-medium text-primary">{t("contactAdmin")}</span>
      </p>
    </>
  );
}
