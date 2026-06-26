import { useState } from "react";
import { loginSchema } from "@shared/validation/auth.js";
import { Field, TextInput, PasswordInput, Button, ErrorText } from "../../components/ui";
import { useAuth } from "./useAuth";
import AuthShell from "./AuthShell";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError("Enter your username and password.");
      return;
    }
    setPending(true);
    try {
      await login(parsed.data.username, parsed.data.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorText>{error}</ErrorText>}
        <Field label="Username">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
