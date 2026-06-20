#!/usr/bin/env node
/**
 * Crée un compte superadmin en une commande (Supabase Admin API + user_roles).
 *
 * Prérequis : migrations appliquées sur le projet (table user_roles).
 * Usage :
 *   npm run create-superadmin
 *   npm run create-superadmin -- --email vous@exemple.com --password MonMotDePasse123
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

function parseArgs(argv) {
  const args = { email: null, password: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email" && argv[i + 1]) args.email = argv[++i];
    if (argv[i] === "--password" && argv[i + 1]) args.password = argv[++i];
  }
  return args;
}

async function findUserByEmail(admin, email) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function main() {
  const env = loadEnv();
  const cli = parseArgs(process.argv.slice(2));

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const email =
    cli.email ||
    env.LOCAL_SUPERADMIN_EMAIL ||
    env.SUPERADMIN_EMAIL ||
    "isidoretabati@gmail.com";
  const password =
    cli.password ||
    env.LOCAL_SUPERADMIN_PASSWORD ||
    env.SUPERADMIN_PASSWORD ||
    "SuperAdmin123!";

  if (!url || !serviceKey) {
    console.error(
      "❌ Manque SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env\n" +
        "   Récupérez la service_role key : Supabase Dashboard → Settings → API"
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Vérifie que le schéma existe
  const { error: schemaError } = await supabase.from("user_roles").select("user_id").limit(1);
  if (schemaError?.code === "42P01" || schemaError?.message?.includes("does not exist")) {
    console.error(
      "❌ La table user_roles n'existe pas encore.\n" +
        "   Appliquez d'abord les migrations :\n" +
        "   → Supabase Dashboard → SQL Editor → collez scripts/apply-all-migrations.sql → Run\n" +
        "   Puis relancez : npm run create-superadmin"
    );
    process.exit(1);
  }
  if (schemaError) {
    console.error("❌ Erreur schéma :", schemaError.message);
    process.exit(1);
  }

  let userId;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Super Admin" },
  });

  if (createError) {
    const exists =
      createError.message?.includes("already been registered") ||
      createError.message?.includes("already exists");
    if (!exists) {
      console.error("❌ Création utilisateur :", createError.message);
      process.exit(1);
    }
    const existing = await findUserByEmail(supabase, email);
    if (!existing) {
      console.error("❌ Compte existant mais introuvable :", createError.message);
      process.exit(1);
    }
    userId = existing.id;
    console.log(`ℹ️  Compte existant : ${email}`);
  } else {
    userId = created.user.id;
    console.log(`✅ Compte créé : ${email}`);
  }

  const { error: delError } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (delError) {
    console.error("❌ Suppression anciens rôles :", delError.message);
    process.exit(1);
  }

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role: "superadmin" });
  if (roleError) {
    console.error("❌ Attribution superadmin :", roleError.message);
    process.exit(1);
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    { id: userId, full_name: "Super Admin", country: null },
    { onConflict: "id" }
  );
  if (profileError) {
    console.error("❌ Profil :", profileError.message);
    process.exit(1);
  }

  console.log("");
  console.log("🎉 Superadmin prêt");
  console.log(`   Email    : ${email}`);
  console.log(`   Password : ${password}`);
  console.log(`   User ID  : ${userId}`);
  console.log("");
  console.log("   Connectez-vous sur http://localhost:8086/auth");
}

main().catch((err) => {
  console.error("❌", err.message || err);
  process.exit(1);
});
