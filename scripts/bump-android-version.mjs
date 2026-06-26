#!/usr/bin/env node
// Incrémente versionCode (+1) et fixe versionName dans build.gradle pour
// l'app chauffeur, voyageur, ou les deux. La Play Console refuse un upload
// dont le versionCode n'est pas strictement supérieur au précédent : ce
// script évite l'oubli.
//
// Usage :
//   node scripts/bump-android-version.mjs driver
//   node scripts/bump-android-version.mjs passenger
//   node scripts/bump-android-version.mjs all [--name 1.1.0]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function bump(app, newVersionName) {
  const path = join(root, `android-${app}`, "app", "build.gradle");
  let content = readFileSync(path, "utf8");

  const codeMatch = content.match(/versionCode\s+(\d+)/);
  if (!codeMatch) throw new Error(`versionCode introuvable dans ${path}`);
  const oldCode = Number(codeMatch[1]);
  const newCode = oldCode + 1;
  content = content.replace(/versionCode\s+\d+/, `versionCode ${newCode}`);

  const nameMatch = content.match(/versionName\s+"([^"]+)"/);
  const oldName = nameMatch?.[1] ?? "?";
  if (newVersionName) {
    content = content.replace(/versionName\s+"[^"]+"/, `versionName "${newVersionName}"`);
  }

  writeFileSync(path, content);
  console.log(
    `[${app}] versionCode ${oldCode} -> ${newCode}` +
      (newVersionName ? `, versionName ${oldName} -> ${newVersionName}` : `, versionName inchangé (${oldName})`),
  );
}

const args = process.argv.slice(2);
const target = args[0] ?? "all";
const nameFlagIdx = args.indexOf("--name");
const newVersionName = nameFlagIdx !== -1 ? args[nameFlagIdx + 1] : undefined;

if (!["driver", "passenger", "all"].includes(target)) {
  console.error("Usage: node scripts/bump-android-version.mjs [driver|passenger|all] [--name 1.1.0]");
  process.exit(1);
}

if (target === "all") {
  bump("driver", newVersionName);
  bump("passenger", newVersionName);
} else {
  bump(target, newVersionName);
}
