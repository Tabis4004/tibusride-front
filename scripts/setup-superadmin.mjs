#!/usr/bin/env node
/**
 * Setup complet : migrations + compte superadmin en une commande.
 *
 * Ajoutez dans .env (Supabase Dashboard → Database → Connection string → URI) :
 *   DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-....pooler.supabase.com:6543/postgres
 *
 * Usage : npm run setup:superadmin
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function schemaReady(url, serviceKey) {
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.from("user_roles").select("user_id").limit(1);
  if (!error) return true;
  return !(
    error.code === "42P01" ||
    error.message?.includes("does not exist") ||
    error.message?.includes("schema cache")
  );
}

function applyMigrations(databaseUrl) {
  const sqlFile = resolve(root, "scripts/apply-all-migrations.sql");
  console.log("📦 Application des migrations...");
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    stdio: "inherit",
    cwd: root,
  });
  if (result.status !== 0) {
    console.error("❌ Échec migrations (psql). Vérifiez DATABASE_URL dans .env");
    process.exit(1);
  }
  console.log("✅ Migrations appliquées\n");
}

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL;

  if (!url || !serviceKey) {
    console.error("❌ Manque SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env");
    process.exit(1);
  }

  const ready = await schemaReady(url, serviceKey);
  if (!ready) {
    if (!databaseUrl) {
      console.error(
        "❌ Schéma absent. Deux options (une seule fois) :\n\n" +
          "   A) Ajoutez DATABASE_URL dans .env puis relancez :\n" +
          "      npm run setup:superadmin\n\n" +
          "      (Dashboard → Database → Connection string → URI)\n\n" +
          "   B) SQL Editor → collez scripts/apply-all-migrations.sql → Run\n" +
          "      puis : npm run create-superadmin"
      );
      process.exit(1);
    }
    applyMigrations(databaseUrl);
  } else {
    console.log("ℹ️  Schéma déjà en place, on passe à la création du compte.\n");
  }

  const result = spawnSync("node", [resolve(root, "scripts/create-superadmin.mjs"), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: root,
  });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error("❌", err.message || err);
  process.exit(1);
});
