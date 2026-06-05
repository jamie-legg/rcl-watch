import { Pool } from "pg";

// Canonical rcl_db (DATABASE_URL) — the same Postgres the dashboard/queue use.
// Server-side only; never import this from client components.

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Don't throw at import time — route modules are imported during build.
    throw new Error("Missing DATABASE_URL. Set it to use Watch preferences.");
  }
  pool = new Pool({ connectionString: url, max: 4 });
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
