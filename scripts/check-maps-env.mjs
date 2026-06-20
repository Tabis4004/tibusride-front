#!/usr/bin/env node
/**
 * Diagnostique les clés Google Maps (navigateur + serveur).
 * Usage : npm run check:maps
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

async function test(name, fn) {
  try {
    const msg = await fn();
    console.log(`✅ ${name}: ${msg}`);
    return true;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    return false;
  }
}

const env = loadEnv();
const browserKey = env.VITE_GOOGLE_MAPS_BROWSER_KEY || env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
const serverKey = env.GOOGLE_MAPS_API_KEY;

console.log("\n🔍 Diagnostic Google Maps\n");

if (!browserKey) console.log("⚠️  VITE_GOOGLE_MAPS_BROWSER_KEY manquante");
if (!serverKey) console.log("⚠️  GOOGLE_MAPS_API_KEY manquante");
if (browserKey && serverKey && browserKey === serverKey) {
  console.log("⚠️  Même clé pour navigateur ET serveur — la clé « Sites web » bloque Geocoding/Routes côté serveur.");
  console.log("   → Créez 2 clés : navigateur (Sites web) + serveur (Aucune restriction application)\n");
}

await test("Maps JavaScript (referer localhost:8080)", async () => {
  if (!browserKey) throw new Error("clé navigateur absente");
  const res = await fetch(`https://maps.googleapis.com/maps/api/js?key=${browserKey}`, {
    headers: { Referer: "http://localhost:8080/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes("ApiTargetBlocked")) throw new Error("ApiTargetBlocked — restrictions API sur la clé");
  return "OK";
});

await test("Geocoding serveur", async () => {
  if (!serverKey) throw new Error("GOOGLE_MAPS_API_KEY absente");
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=Dakar&key=${serverKey}`;
  const json = await fetch(url).then((r) => r.json());
  if (json.status !== "OK") throw new Error(json.error_message || json.status);
  return json.results[0].formatted_address;
});

await test("Routes API (itinéraire)", async () => {
  if (!serverKey) throw new Error("GOOGLE_MAPS_API_KEY absente");
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey,
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: 14.6928, longitude: -17.4467 } } },
      destination: { location: { latLng: { latitude: 14.7167, longitude: -17.4677 } } },
      travelMode: "DRIVE",
    }),
  });
  const json = await res.json();
  if (!json.routes?.[0]) {
    const reason = json.error?.details?.find((d) => d.reason)?.reason;
    const msg = json.error?.message || `HTTP ${res.status}`;
    if (reason === "API_KEY_HTTP_REFERRER_BLOCKED" || msg.includes("referer")) {
      throw new Error(
        `${msg} → la clé GOOGLE_MAPS_API_KEY est encore une clé « Sites web ». Utilisez la clé serveur (restriction application : Aucune).`,
      );
    }
    if (msg.includes("not been used") || msg.includes("disabled") || reason === "SERVICE_DISABLED") {
      throw new Error(`${msg} → activez « Routes API » dans APIs et services → Bibliothèque.`);
    }
    throw new Error(
      `${msg}${reason ? ` (${reason})` : ""} → ajoutez « Routes API » aux restrictions API de la clé serveur.`,
    );
  }
  return "polyline OK";
});

await test("Places API (autocomplete)", async () => {
  if (!serverKey) throw new Error("GOOGLE_MAPS_API_KEY absente");
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey,
    },
    body: JSON.stringify({ input: "Plateau Abidjan", languageCode: "fr", includedRegionCodes: ["ci"] }),
  });
  const json = await res.json();
  if (!json.suggestions?.length) {
    const reason = json.error?.details?.find((d) => d.reason)?.reason;
    const msg = json.error?.message || "aucune suggestion";
    if (reason === "API_KEY_HTTP_REFERRER_BLOCKED" || msg.includes("referer")) {
      throw new Error(`${msg} → clé serveur avec restriction « Sites web » (mettre Aucune).`);
    }
    throw new Error(`${msg} → activez « Places API (New) » et ajoutez-la à la clé serveur.`);
  }
  return `${json.suggestions.length} suggestion(s)`;
});

await test("Maps JavaScript (referer Vercel prod)", async () => {
  if (!browserKey) throw new Error("clé navigateur absente");
  const res = await fetch(`https://maps.googleapis.com/maps/api/js?key=${browserKey}`, {
    headers: { Referer: "https://tibusride-front.vercel.app/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes("ApiTargetBlocked")) {
    throw new Error("ApiTargetBlocked — ajoutez https://tibusride-front.vercel.app/* à la clé navigateur");
  }
  return "OK";
});

console.log("\n📋 Clé navigateur (VITE_GOOGLE_MAPS_BROWSER_KEY)");
console.log("   Google Cloud → Identifiants → restriction « Sites web » :");
console.log("   http://localhost:8080/*  +  https://tibusride-front.vercel.app/*");
console.log("   APIs autorisées : Maps JavaScript API\n");
console.log("📋 Clé serveur (GOOGLE_MAPS_API_KEY)");
console.log("   Restriction application : Aucune (pas « Sites web »)");
console.log("   APIs autorisées : Geocoding API, Routes API, Places API (New)\n");
