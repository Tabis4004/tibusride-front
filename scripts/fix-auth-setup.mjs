#!/usr/bin/env node
/**
 * Vérifie le .env local et affiche ce qu'il faut copier sur Vercel.
 * Usage : npm run fix:auth
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];

const env = loadEnv();
console.log("\n🔧 Tibus Ride — diagnostic auth\n");

let ok = true;
for (const k of REQUIRED) {
  const v = env[k];
  const bad = !v || v.includes("your-") || v.includes("[VOTRE") || v === "eyJ...";
  console.log(`${bad ? "❌" : "✅"} ${k}${bad ? " (manquant ou placeholder)" : ""}`);
  if (bad) ok = false;
}

if (!ok) {
  console.log("\n→ Complétez .env depuis .env.example puis relancez.\n");
  process.exit(1);
}

// Test login Supabase
const email = env.SUPERADMIN_EMAIL || env.LOCAL_SUPERADMIN_EMAIL || "isidoretabati@gmail.com";
const password = env.SUPERADMIN_PASSWORD || env.LOCAL_SUPERADMIN_PASSWORD || "SuperAdmin123!";
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users } = await admin.auth.admin.listUsers({ perPage: 50 });
const user = users?.users?.find((u) => u.email === email);
if (!user) {
  console.log(`\n⚠️  Compte ${email} absent — lancez : npm run create-superadmin\n`);
} else {
  await admin.auth.admin.updateUserById(user.id, { password });
  const test = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  console.log(test.access_token ? `\n✅ Login Supabase OK (${email})` : `\n❌ Login échoue : ${test.error_description || test.msg}`);
}

console.log("\n📋 Variables à copier sur Vercel → Settings → Environment Variables");
console.log("   (Production + Preview + Development), puis REDÉPLOYER :\n");
for (const k of REQUIRED) {
  console.log(`${k}=${env[k]}`);
}
console.log("\n⚠️  Les VITE_* sont injectées au BUILD — un simple ajout sans redeploy ne suffit pas.");
console.log("🌐 Supabase → Auth → Redirect URLs : https://tibusride-front.vercel.app/**\n");
