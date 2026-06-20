#!/usr/bin/env node
/**
 * Affiche les variables à configurer sur Vercel pour le login Supabase.
 * Usage : node scripts/setup-vercel-env.mjs
 *
 * Puis dans Vercel → Settings → Environment Variables (Production + Preview)
 * ou : vercel env add SUPABASE_URL production
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  "VITE_SUPABASE_PROJECT_ID",
];

const env = loadEnv();

console.log("\n📋 Variables Vercel requises pour le login Supabase\n");
for (const key of REQUIRED) {
  const val = env[key];
  const status = val ? `✅ (${val.slice(0, 24)}…)` : "❌ MANQUANTE dans .env local";
  console.log(`  ${key}: ${status}`);
}

console.log("\n🔗 Supabase Dashboard → Authentication → URL Configuration :");
console.log("   Site URL : https://tibusride-front.vercel.app");
console.log("   Redirect URLs :");
console.log("     https://tibusride-front.vercel.app/**");
console.log("     http://localhost:8080/**\n");

console.log("Après ajout sur Vercel → Redeploy (Deployments → ⋯ → Redeploy)\n");
