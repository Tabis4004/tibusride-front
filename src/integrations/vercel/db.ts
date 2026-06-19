import { neon, neonConfig } from "@neondatabase/serverless";
import type { Pool as PgPool } from "pg";

neonConfig.fetchConnectionCache = true;

function getDatabaseUrl() {
  const postgres = process.env.POSTGRES_URL?.trim();
  const database = process.env.DATABASE_URL?.trim();

  if (postgres) return postgres;

  if (process.env.NODE_ENV !== "production" && database && !isLocalPostgres(database)) {
    throw new Error(
      "POSTGRES_URL manquant en local. Ajoutez POSTGRES_URL=postgresql://USER@localhost:5432/tibusride dans .env puis redémarrez npm run dev.",
    );
  }

  const url = database ?? "";
  if (!url) {
    throw new Error(
      "Missing POSTGRES_URL (or DATABASE_URL). " +
        "Local : postgresql://USER@localhost:5432/tibusride — " +
        "Ajoutez aussi AUTH_SECRET dans .env puis redémarrez npm run dev.",
    );
  }
  return url;
}

function getPostgresHost(url: string) {
  try {
    const normalized = url.replace(/^postgres:\/\//, "postgresql://");
    return new URL(normalized).hostname;
  } catch {
    const match = url.match(/@([^/?:]+)/);
    return match?.[1] ?? "";
  }
}

function isLocalPostgres(url: string) {
  const host = getPostgresHost(url);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Local Postgres → driver `pg`. Remote (Neon/Vercel) → serverless. */
function usePgDriver(url: string) {
  if (isLocalPostgres(url)) return true;
  // En dev local, forcer pg si POSTGRES_URL pointe vers localhost (évite fetch Neon).
  if (process.env.NODE_ENV !== "production" && process.env.FORCE_NEON_DRIVER !== "true") {
    return isLocalPostgres(url);
  }
  return false;
}

let _sql: ReturnType<typeof neon> | undefined;
let _pgPool: PgPool | undefined;

async function getPgPool() {
  if (!_pgPool) {
    const { Pool } = await import("pg");
    _pgPool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return _pgPool;
}

function getSql() {
  const url = getDatabaseUrl();
  if (usePgDriver(url)) {
    throw new Error("Use queryRows/sql via pg pool for local Postgres");
  }
  if (!_sql) _sql = neon(url);
  return _sql;
}

async function runQuery(userId: string | null, query: string, params: unknown[]) {
  const url = getDatabaseUrl();
  if (usePgDriver(url)) {
    const pool = await getPgPool();
    const client = await pool.connect();
    try {
      if (userId) {
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      }
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  try {
    const client = await pool.connect();
    try {
      if (userId) {
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      }
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/** Lazy — évite un crash au démarrage si .env n'est pas encore configuré. */
export const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const url = getDatabaseUrl();
  if (usePgDriver(url)) {
    let text = strings[0];
    for (let i = 1; i < strings.length; i++) {
      text += `$${i}` + strings[i];
    }
    const pool = await getPgPool();
    const result = await pool.query(text, values);
    return result.rows;
  }
  return getSql()(strings, ...values);
}) as ReturnType<typeof neon>;

export async function withUserContext<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  if (userId && !usePgDriver(getDatabaseUrl())) {
    await sql`SELECT set_config('app.current_user_id', ${userId}, true)`;
  }
  return fn();
}

export async function queryRows<T extends Record<string, unknown>>(
  userId: string | null,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withUserContext(userId, async () => {
    const rows = await runQuery(userId, query, params);
    return rows as T[];
  });
}

export async function queryOne<T extends Record<string, unknown>>(
  userId: string | null,
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(userId, query, params);
  return rows[0] ?? null;
}

export async function exec(userId: string | null, query: string, params: unknown[] = []) {
  const rows = await queryRows(userId, query, params);
  return rows;
}

/** Service-level queries (webhooks, admin jobs) — no RLS user context. */
export async function serviceQuery<T extends Record<string, unknown>>(query: string, params: unknown[] = []) {
  return queryRows<T>(null, query, params);
}

export async function serviceOne<T extends Record<string, unknown>>(query: string, params: unknown[] = []) {
  return queryOne<T>(null, query, params);
}
