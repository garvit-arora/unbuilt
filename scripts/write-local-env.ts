/**
 * `npm run db:env`: copies the local Supabase URL and keys from `npx supabase status -o json`
 * into .env.local (created from .env.example when missing). Other lines are left untouched.
 * .env.local is git-ignored and must never be committed.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT, ".env.local");
const EXAMPLE_FILE = resolve(ROOT, ".env.example");

type Status = Record<string, string | undefined>;

function readStatus(): Status {
  let stdout: string;
  try {
    stdout = execSync("npx supabase status -o json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    throw new Error(`Could not read the local Supabase status. Is the stack running (npx supabase start)?\n${stderr}`);
  }
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Unexpected output from supabase status:\n${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1)) as Status;
}

/** Supabase CLI versions differ: older ones print ANON_KEY/SERVICE_ROLE_KEY, newer ones PUBLISHABLE_KEY/SECRET_KEY. */
function pickKeys(status: Status) {
  const url = status.API_URL;
  const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(`supabase status is missing API_URL or keys (got: ${Object.keys(status).join(", ")})`);
  }
  return { url, anonKey, serviceRoleKey };
}

function upsertEnv(content: string, values: Record<string, string>): string {
  const lines = content.split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

function main() {
  const { url, anonKey, serviceRoleKey } = pickKeys(readStatus());
  if (!existsSync(ENV_FILE)) {
    if (existsSync(EXAMPLE_FILE)) copyFileSync(EXAMPLE_FILE, ENV_FILE);
    else writeFileSync(ENV_FILE, "");
  }
  const next = upsertEnv(readFileSync(ENV_FILE, "utf8"), {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  });
  writeFileSync(ENV_FILE, next);
  console.log(`Wrote Supabase URL and keys for ${url} to .env.local`);
}

main();
