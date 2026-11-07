import { z } from "zod";

/** Sign-in / sign-up form rules (design 6.2). Supabase Auth enforces them again server-side. */

export const SignInSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(1, "Enter your password"),
});

export const SignUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(80, "At most 80 characters"),
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["buyer", "builder"]),
});

export type SignInInput = z.infer<typeof SignInSchema>;
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const DEMO_ACCOUNTS = [
  { role: "buyer", email: "buyer@unbuilt.demo", label: "Sign in as demo buyer" },
  { role: "builder", email: "builder@unbuilt.demo", label: "Sign in as demo builder" },
  { role: "admin", email: "admin@unbuilt.demo", label: "Sign in as demo admin" },
] as const;
