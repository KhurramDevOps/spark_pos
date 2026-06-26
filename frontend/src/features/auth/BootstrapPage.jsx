import { useState } from "react";
import { bootstrapSchema } from "@shared/validation/auth.js";
import { Field, TextInput, PasswordInput, Button, ErrorText } from "../../components/ui";
import { useAuth } from "./useAuth";
import AuthShell from "./AuthShell";

/**
 * First-run only: shown when the setup gate reports no users exist yet. Creates
 * the first owner — the single owner-creation path (workers are made later from
 * the owner-only Users screen).
 */
export default function BootstrapPage() {
  const { bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setServerError("");
    const parsed = bootstrapSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setPending(true);
    try {
      await bootstrap(parsed.data.username, parsed.data.password);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="Create the owner account" subtitle="First-time setup">
      <form onSubmit={handleSubmit} className="space-y-4">
        {serverError && <ErrorText>{serverError}</ErrorText>}
        {errors.length > 0 && (
          <ErrorText>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </ErrorText>
        )}
        <Field label="Username" hint="Lowercase letters, numbers, underscore or hyphen.">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating…" : "Create owner & sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
