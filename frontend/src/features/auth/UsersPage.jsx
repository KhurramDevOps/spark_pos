import { useState } from "react";
import { createWorkerSchema, resetPasswordSchema } from "@shared/validation/auth.js";
import { Badge, Button, Modal, Field, TextInput, PasswordInput, ErrorText } from "../../components/ui";
import { useAuth } from "./useAuth";
import { useUsers, useCreateWorker, useDeactivateUser, useResetPassword } from "./hooks";

/** Owner-only (App hides this whole screen from workers; the server guards it too). */
export default function UsersPage() {
  const { user: me } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [rowError, setRowError] = useState("");

  const { data, isLoading, isError, error } = useUsers();
  const users = data?.users ?? [];
  const deactivate = useDeactivateUser();

  async function handleDeactivate(u) {
    setRowError("");
    try {
      await deactivate.mutateAsync(u._id);
    } catch (err) {
      setRowError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Users</h1>
          <p className="text-sm text-fg-muted">
            Workers you let into the shop. Only you (the owner) can see or change this.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ New worker</Button>
      </header>

      {rowError && <div className="mb-3"><ErrorText>{rowError}</ErrorText></div>}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Username</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-fg-subtle">Loading…</td></tr>
            ) : isError ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-red-600 dark:text-red-400">{error.message}</td></tr>
            ) : (
              users.map((u) => {
                const isSelf = String(u._id) === String(me?._id);
                return (
                  <tr key={u._id} className="hover:bg-muted">
                    <td className="px-4 py-2.5 text-fg">
                      {u.username}
                      {isSelf && <span className="ml-2 text-xs text-fg-subtle">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={u.role === "owner" ? "green" : "gray"}>{u.role}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          className="text-xs font-medium text-fg-muted hover:text-fg"
                          onClick={() => setResetFor(u)}
                        >
                          Reset password
                        </button>
                        {!isSelf && u.isActive && (
                          <button
                            className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
                            onClick={() => handleDeactivate(u)}
                            disabled={deactivate.isPending}
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showNew && <CreateWorkerModal onClose={() => setShowNew(false)} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function CreateWorkerModal({ onClose }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const create = useCreateWorker();

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");
    const parsed = createWorkerSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      onClose();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title="New worker"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-worker-form" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create worker"}
          </Button>
        </>
      }
    >
      <form id="new-worker-form" onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </ErrorText>
        )}
        <Field label="Username" hint="Lowercase letters, numbers, underscore or hyphen.">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters. Share it with them; they can change it from their profile.">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(false);
  const reset = useResetPassword();

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");
    const parsed = resetPasswordSchema.safeParse({ newPassword });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    try {
      await reset.mutateAsync({ id: user._id, newPassword: parsed.data.newPassword });
      setDone(true);
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <Modal
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      footer={
        done ? (
          <Button type="button" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="reset-pw-form" disabled={reset.isPending}>
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-sm text-fg-muted">
          Password reset. Their other sessions are signed out — give them the new password.
        </p>
      ) : (
        <form id="reset-pw-form" onSubmit={handleSubmit} className="space-y-4">
          {serverError && <ErrorText>{serverError}</ErrorText>}
          {errors.length > 0 && (
            <ErrorText>
              <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </ErrorText>
          )}
          <Field label="New password" hint="At least 8 characters.">
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus autoComplete="new-password" />
          </Field>
        </form>
      )}
    </Modal>
  );
}
