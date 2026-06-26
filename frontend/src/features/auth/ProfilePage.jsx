import { useState } from "react";
import { changePasswordSchema } from "@shared/validation/auth.js";
import { Badge, Button, Field, TextInput, ErrorText } from "../../components/ui";
import { useAuth } from "./useAuth";
import * as api from "./api";

export default function ProfilePage() {
  const { user, logout } = useAuth();

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-fg">Your account</h1>
      </header>

      <div className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg-muted">Username</span>
          <span className="text-sm font-medium text-fg">{user?.username}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg-muted">Role</span>
          <Badge tone={user?.role === "owner" ? "green" : "gray"}>{user?.role}</Badge>
        </div>
        <div className="border-t border-line pt-4">
          <Button variant="danger" onClick={logout}>Log out</Button>
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");
    setDone(false);

    if (newPassword !== confirm) {
      setErrors(["The new password and its confirmation don't match."]);
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setPending(true);
    try {
      await api.changePassword(parsed.data);
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setServerError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-4 text-base font-semibold text-fg">Change password</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {done && (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/60 dark:text-green-300">
            Password changed. Your other sessions have been signed out.
          </div>
        )}
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </ErrorText>
        )}
        <Field label="Current password">
          <TextInput type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}
