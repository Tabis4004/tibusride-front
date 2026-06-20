#!/usr/bin/env node
/**
 * Simule une course avec déplacement du chauffeur sur la carte.
 * Usage :
 *   npm run simulate:ride          — course complète (~24s)
 *   npm run simulate:ride -- --live — course en boucle (Ctrl+C pour arrêter)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^"|"$/g, "");
    out[k] = v;
  }
  return out;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const live = process.argv.includes("--live");
  const { createClient } = await import("@supabase/supabase-js");
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env");
    process.exit(1);
  }

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = env.SIM_USER_EMAIL || "isidoretabati@gmail.com";
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`❌ Utilisateur introuvable : ${email}`);
    process.exit(1);
  }
  const uid = user.id;

  const pickup = { lat: 14.6928, lng: -17.4467, address: "Place de l'Indépendance, Dakar" };
  const dropoff = { lat: 14.7397, lng: -17.5122, address: "Almadies, Dakar" };
  const port = env.DEV_PORT || "8080";

  console.log(`👤 Utilisateur : ${email}`);

  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", uid);
  const have = new Set((roles ?? []).map((r) => r.role));
  for (const role of ["passenger", "driver"]) {
    if (!have.has(role)) {
      await sb.from("user_roles").insert({ user_id: uid, role });
      console.log(`✅ Rôle ajouté : ${role}`);
    }
  }

  await sb.from("profiles").upsert(
    { id: uid, full_name: "Test Driver", phone: "+221770000000", city: "Dakar", country: "SN" },
    { onConflict: "id" },
  );

  const { data: existingDriver } = await sb
    .from("driver_profiles")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (!existingDriver) {
    const { error } = await sb.from("driver_profiles").insert({
      user_id: uid,
      status: "approved",
      is_online: true,
      city: "Dakar",
      license_number: "DK-TEST-001",
      rating_avg: 4.8,
    });
    if (error) {
      console.error("❌ driver_profiles :", error.message);
      process.exit(1);
    }
    console.log("✅ Profil chauffeur créé");
  } else {
    await sb.from("driver_profiles").update({ status: "approved", is_online: true, city: "Dakar" }).eq("user_id", uid);
  }

  await sb
    .from("rides")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("passenger_id", uid)
    .in("status", ["requested", "accepted", "arriving", "in_progress"]);

  const price = 3500;
  const { data: ride, error: rideErr } = await sb
    .from("rides")
    .insert({
      passenger_id: uid,
      pickup_address: pickup.address,
      dropoff_address: dropoff.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      city: "Dakar",
      country: "SN",
      category: "eco",
      distance_km: 8.2,
      duration_min: 22,
      price_xof: price,
      payment_method: "cash",
      status: "accepted",
      requested_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
      driver_id: uid,
      driver_lat: pickup.lat - 0.02,
      driver_lng: pickup.lng - 0.01,
      driver_location_updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (rideErr || !ride) {
    console.error("❌ Création course :", rideErr?.message);
    process.exit(1);
  }

  console.log(`🚕 Course active : ${ride.id}`);
  console.log(`🗺️  Carte : http://localhost:${port}/app/passenger (connectez-vous d'abord)\n`);

  const animate = async (steps, intervalMs) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const phase = t < 0.45 ? "arriving" : "in_progress";
      const localT = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55;
      const from = t < 0.45 ? { lat: pickup.lat - 0.02, lng: pickup.lng - 0.01 } : pickup;
      const to = t < 0.45 ? pickup : dropoff;
      const lat = lerp(from.lat, to.lat, localT);
      const lng = lerp(from.lng, to.lng, localT);
      const ts = new Date().toISOString();

      await sb
        .from("rides")
        .update({
          status: phase,
          driver_lat: lat,
          driver_lng: lng,
          driver_location_updated_at: ts,
          ...(phase === "in_progress" && localT < 0.05 ? { started_at: ts } : {}),
        })
        .eq("id", ride.id);

      console.log(`   [${i}/${steps}] ${phase} — ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      await sleep(intervalMs);
    }
  };

  if (live) {
    console.log("🔴 Mode live — Ctrl+C pour arrêter\n");
    let loop = 0;
    while (true) {
      loop++;
      console.log(`--- Boucle ${loop} ---`);
      await animate(12, 3000);
    }
  }

  await animate(12, 2000);

  const done = new Date().toISOString();
  await sb
    .from("rides")
    .update({
      status: "completed",
      completed_at: done,
      driver_lat: dropoff.lat,
      driver_lng: dropoff.lng,
      driver_location_updated_at: done,
    })
    .eq("id", ride.id);

  await sb.from("payments").insert({
    ride_id: ride.id,
    amount: price,
    payment_method: "cash",
    payment_status: "paid",
    paid_at: done,
  });

  console.log("\n🎉 Course terminée !");
  console.log(`   Détail : http://localhost:${port}/app/ride/${ride.id}`);
  console.log("   Mode live : npm run simulate:ride -- --live");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
