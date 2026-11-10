"use client";

import { Hammer, Lightbulb, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SignInSchema, SignUpSchema, type SignUpInput } from "@/lib/schemas/auth";
import { getBrowserSupabase } from "@/lib/supabase-browser";

type Mode = "sign-in" | "sign-up";
type FieldErrors = Partial<Record<"displayName" | "email" | "password" | "role", string>>;

export function AuthForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [signIn, setSignIn] = useState({ email: "", password: "" });
  const [signUp, setSignUp] = useState<SignUpInput>({ displayName: "", email: "", password: "", role: "buyer" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [navigating, startTransition] = useTransition();
  const pending = busy || navigating;

  function changeMode(value: Mode) {
    setMode(value);
    setErrors({});
    setFormError(null);
    setNotice(null);
  }

  async function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = SignInSchema.safeParse(signIn);
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error.issues));
    setErrors({}); setBusy(true);
    try {
      const { error } = await getBrowserSupabase().auth.signInWithPassword(parsed.data);
      if (error) { setFormError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message); return; }
      startTransition(() => window.location.assign(next));
    } catch (error) { setFormError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null); setNotice(null);
    const parsed = SignUpSchema.safeParse(signUp);
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error.issues));
    setErrors({}); setBusy(true);
    try {
      const { data, error } = await getBrowserSupabase().auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { display_name: parsed.data.displayName, role: parsed.data.role } } });
      if (error) { setFormError(error.message); return; }
      if (data.session) { startTransition(() => window.location.assign(next)); return; }
      setSignIn({ email: parsed.data.email, password: "" });
      setMode("sign-in");
      setNotice("Account created. Check your inbox to confirm your email, then sign in.");
    } catch (error) { setFormError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="auth-form-wrap">
    <header className="auth-form-heading">
      <span>{mode === "sign-in" ? "Welcome back" : "Start something"}</span>
      <h1>{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
      <p>{mode === "sign-in" ? "Enter your details to continue to your ideas." : "Join people turning real wishes into products."}</p>
    </header>

    {mode === "sign-in" ? <form className="auth-login-form" onSubmit={submitSignIn} noValidate aria-label="Sign in">
      <AuthField id="signin-email" label="Email" icon={<Mail />} error={errors.email}><Input id="signin-email" type="email" autoComplete="email" value={signIn.email} onChange={(event) => setSignIn({ ...signIn, email: event.target.value })} aria-invalid={Boolean(errors.email)} placeholder="you@example.com" /></AuthField>
      <AuthField id="signin-password" label="Password" icon={<LockKeyhole />} error={errors.password}><Input id="signin-password" type="password" autoComplete="current-password" value={signIn.password} onChange={(event) => setSignIn({ ...signIn, password: event.target.value })} aria-invalid={Boolean(errors.password)} placeholder="Enter your password" /></AuthField>
      <AuthMessages error={formError} notice={notice} />
      <Button type="submit" size="lg" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Sign in</Button>
    </form> : <form className="auth-login-form" onSubmit={submitSignUp} noValidate aria-label="Create account">
      <AuthField id="signup-name" label="Display name" icon={<UserRound />} error={errors.displayName}><Input id="signup-name" autoComplete="name" maxLength={80} value={signUp.displayName} onChange={(event) => setSignUp({ ...signUp, displayName: event.target.value })} aria-invalid={Boolean(errors.displayName)} placeholder="What should we call you?" /></AuthField>
      <AuthField id="signup-email" label="Email" icon={<Mail />} error={errors.email}><Input id="signup-email" type="email" autoComplete="email" value={signUp.email} onChange={(event) => setSignUp({ ...signUp, email: event.target.value })} aria-invalid={Boolean(errors.email)} placeholder="you@example.com" /></AuthField>
      <AuthField id="signup-password" label="Password" icon={<LockKeyhole />} error={errors.password}><Input id="signup-password" type="password" autoComplete="new-password" value={signUp.password} onChange={(event) => setSignUp({ ...signUp, password: event.target.value })} aria-invalid={Boolean(errors.password)} placeholder="At least 8 characters" /></AuthField>
      <fieldset className="auth-role-picker"><legend>I&apos;m joining as</legend><RadioGroup value={signUp.role} onValueChange={(role) => setSignUp({ ...signUp, role: role as SignUpInput["role"] })} className="grid-cols-2">
        <Label htmlFor="auth-role-buyer"><RadioGroupItem id="auth-role-buyer" value="buyer" /><Lightbulb /><span><b>Buyer</b><small>Share ideas</small></span></Label>
        <Label htmlFor="auth-role-builder"><RadioGroupItem id="auth-role-builder" value="builder" /><Hammer /><span><b>Builder</b><small>Build products</small></span></Label>
      </RadioGroup></fieldset>
      <AuthMessages error={formError} notice={notice} />
      <Button type="submit" size="lg" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Create account</Button>
    </form>}

    <p className="auth-account-switch">{mode === "sign-in" ? "Don’t have an account?" : "Already have an account?"}<button type="button" onClick={() => changeMode(mode === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? "Create one" : "Sign in"}</button></p>
  </div>;
}

function AuthField({ id, label, icon, error, children }: { id: string; label: string; icon: ReactNode; error?: string; children: ReactNode }) { return <div><Label htmlFor={id}>{label}</Label><span className="auth-input">{icon}{children}</span>{error ? <p>{error}</p> : null}</div>; }
function AuthMessages({ error, notice }: { error: string | null; notice: string | null }) { return <>{error ? <p className="auth-form-error" role="alert">{error}</p> : null}{notice ? <p className="auth-form-notice" role="status">{notice}</p> : null}</>; }
function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors { const result: FieldErrors = {}; for (const issue of issues) result[String(issue.path[0]) as keyof FieldErrors] ??= issue.message; return result; }
