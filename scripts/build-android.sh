#!/usr/bin/env bash
# Build AAB (+ APK) signés pour l'app chauffeur et/ou voyageur, en une commande.
#
# Usage :
#   bash scripts/build-android.sh driver       # build uniquement l'app chauffeur
#   bash scripts/build-android.sh passenger    # build uniquement l'app voyageur
#   bash scripts/build-android.sh all          # build les deux (défaut)
#
# Pré-requis : avoir suivi android-driver/keystore.properties.example et
# android-passenger/keystore.properties.example (clé de signature release).
# Sans ces fichiers, le build reste possible mais produit un artefact NON
# signé (refusé par la Play Console).
#
# Important : les deux apps chargent le site en direct (server.url dans
# capacitor.*.config.ts) — ce script ne reconstruit donc PAS le site web.
# Si tu as changé du code web, déploie-le sur Vercel séparément ; les apps
# natives le récupéreront automatiquement à l'ouverture.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"

build_one() {
  local name="$1"
  local dir="android-$name"

  echo ""
  echo "=== [$name] npm run cap:sync:$name ==="
  npm run "cap:sync:$name"

  echo "=== [$name] gradlew bundleRelease + assembleRelease ==="
  (cd "$dir" && ./gradlew bundleRelease assembleRelease)

  local aab="$dir/app/build/outputs/bundle/release/app-release.aab"
  local apk="$dir/app/build/outputs/apk/release/app-release.apk"

  echo ""
  if [ -f "$dir/keystore.properties" ]; then
    echo "[$name] OK — build SIGNÉ (release)."
  else
    echo "[$name] ATTENTION — pas de $dir/keystore.properties : build NON signé,"
    echo "        impossible à uploader sur la Play Console. Voir $dir/keystore.properties.example."
  fi
  [ -f "$aab" ] && echo "  AAB : $aab"
  [ -f "$apk" ] && echo "  APK : $apk"
}

case "$TARGET" in
  driver) build_one driver ;;
  passenger) build_one passenger ;;
  all)
    build_one driver
    build_one passenger
    ;;
  *)
    echo "Usage: $0 [driver|passenger|all]" >&2
    exit 1
    ;;
esac

echo ""
echo "Terminé."
