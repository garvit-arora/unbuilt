"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_ACCOUNTS, SignInSchema, SignUpSchema, type SignUpInput } from "@/lib/schemas/auth";
import { getBrowserSupabase } from "@/lib/supabase-browser";

type Props = {
  /** Sanitized redirect target after a successful sign-in. */
  next: string;
  /** Present only when demo mode is on (the server decides; see src/app/auth/page.tsx). */
  demoPassword?: string;
  initialTab?: "sign-in" | "sign-up";
};

type FieldErrors = Partial<Record<string, string>>;

function firstErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function AuthForm({ next, demoPassword, initialTab = "sign-in" }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [navigating, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const [signIn, setSignIn] = useState({ email: "", password: "" });
  const [signUp, setSignUp] = useState<SignUpInput>({ displayName: "", email: "", password: "", role: "buyer" });

  const pending = busy || navigating;

  function finish() {
    startTransition(() => {
      router.replace(next);
      router.refresh();
    });
  }

  async function doSignIn(values: { email: string; password: string }) {
    setFormError(null);
    setNotice(null);
    const parsed = SignInSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(firstErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { error } = await getBrowserSupabase().auth.signInWithPassword(parsed.data);
      if (error) {
        setFormError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
        return;
      }
      finish();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await doSignIn(signIn);
  }

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const parsed = SignUpSchema.safeParse(signUp);
    if (!parsed.success) {
      setErrors(firstErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { data, error } = await getBrowserSupabase().auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: { data: { display_name: parsed.data.displayName, role: parsed.data.role } },
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data.session) {
        setNotice("Check your inbox to confirm your email address, then sign in.");
        setTab("sign-in");
        setSignIn({ email: parsed.data.email, password: "" });
        return;
      }
      finish();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function demoSignIn(email: string) {
    if (!demoPassword) return;
    setTab("sign-in");
    const values = { email, password: demoPassword };
    setSignIn(values);
    await doSignIn(values);
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as typeof tab);
          setFormError(null);
          setErrors({});
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sign-in">Sign in</TabsTrigger>
          <TabsTrigger value="sign-up">Create account</TabsTrigger>
        </TabsList>

        <TabsContent value="sign-in" className="pt-4">
          <form className="flex flex-col gap-4" onSubmit={onSignIn} noValidate aria-label="Sign in">
            <Field id="signin-email" label="Email" error={errors.email}>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                value={signIn.email}
                onChange={(e) => setSignIn({ ...signIn, email: e.target.value })}
                aria-invalid={Boolean(errors.email)}
              />
            </Field>
            <Field id="signin-password" label="Password" error={errors.password}>
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                value={signIn.password}
                onChange={(e) => setSignIn({ ...signIn, password: e.target.value })}
                aria-invalid={Boolean(errors.password)}
              />
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Sign in
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="sign-up" className="pt-4">
          <form className="flex flex-col gap-4" onSubmit={onSignUp} noValidate aria-label="Create account">
            <Field id="signup-name" label="Display name" error={errors.displayName}>
              <Input
                id="signup-name"
                autoComplete="nickname"
                maxLength={80}
                value={signUp.displayName}
                onChange={(e) => setSignUp({ ...signUp, displayName: e.target.value })}
                aria-invalid={Boolean(errors.displayName)}
              />
            </Field>
            <Field id="signup-email" label="Email" error={errors.email}>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={signUp.email}
                onChange={(e) => setSignUp({ ...signUp, email: e.target.value })}
                aria-invalid={Boolean(errors.email)}
              />
            </Field>
            <Field id="signup-password" label="Password" hint="At least 8 characters" error={errors.password}>
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={signUp.password}
                onChange={(e) => setSignUp({ ...signUp, password: e.target.value })}
                aria-invalid={Boolean(errors.password)}
              />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-foreground">I am joining as</legend>
              <RadioGroup
                value={signUp.role}
                onValueChange={(value) => setSignUp({ ...signUp, role: value as SignUpInput["role"] })}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    ["buyer", "Buyer", "Share wishes, join demand, buy"],
                    ["builder", "Builder", "Propose and launch products"],
                  ] as const
                ).map(([value, title, description]) => (
                  <Label
                    key={value}
                    htmlFor={`role-${value}`}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface p-3 font-normal has-data-[state=checked]:border-lime/60"
                  >
                    <RadioGroupItem id={`role-${value}`} value={value} className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm text-foreground">{title}</span>
                      <span className="text-xs text-muted-text">{description}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Create account
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {formError ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
          {notice}
        </p>
      ) : null}

      {demoPassword ? (
        <section className="flex flex-col gap-2 border-t border-line pt-5" aria-label="Demo accounts">
          <p className="text-xs text-muted-text">
            Demo mode: the documented demo accounts sign in through Supabase Auth like any other account.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void demoSignIn(account.email)}
              >
                {account.label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-text">{hint}</p>
      ) : null}
    </div>
  );
}
