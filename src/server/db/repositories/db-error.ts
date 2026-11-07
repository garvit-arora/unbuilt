import "server-only";

export type DbError = Error & { code?: string };

/** Wraps a PostgREST error, keeping the SQLSTATE in `code` so services can map RPC errors. */
export function dbFail(what: string, error: { message: string; code?: string }): never {
  const wrapped = new Error(`${what}: ${error.message}`) as DbError;
  wrapped.code = error.code;
  throw wrapped;
}
