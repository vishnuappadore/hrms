"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PasswordSchema, type User } from "@keystonehr/shared";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useResetEmployeePassword } from "@/lib/queries/employees";

export function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const t = useTranslations("employees.resetPassword");
  const tc = useTranslations("common");
  const reset = useResetEmployeePassword();
  const permissions = usePermissions();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPassword("");
    setConfirm("");
    setError(null);
    reset.reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!PasswordSchema.safeParse(password).success) {
      setError(t("policyError"));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatchError"));
      return;
    }
    setError(null);
    try {
      await reset.mutateAsync({ userId: user.id, password });
      close();
    } catch {
      setError(tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog open={user !== null} onClose={close} title={t("title", { name: user?.name ?? "" })}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <Field label={t("newPassword")} htmlFor="reset-password" required>
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label={t("confirmPassword")} htmlFor="reset-confirm" required>
          <Input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={close}>
            {tc("cancel")}
          </Button>
          {permissions.includes("employee.update") && (
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? tc("saving") : t("action")}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
