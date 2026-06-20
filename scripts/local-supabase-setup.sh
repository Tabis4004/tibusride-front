#!/usr/bin/env bash
# Tibus Ride — Supabase local pour tibus-frontend UNIQUEMENT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(basename "$ROOT")" != "tibus-frontend" ]]; then
  echo "❌ Mauvais dossier : ${ROOT}"
  echo "   Ce script appartient à tibus-frontend/scripts/"
  exit 1
fi

if [[ ! -d "${ROOT}/supabase/migrations" ]]; then
  echo "❌ ${ROOT}/supabase/migrations introuvable"
  exit 1
fi

cd "$ROOT"
echo "📁 tibus-frontend"
echo "   ${ROOT}"
echo ""

SUPABASE_EMAIL="${LOCAL_SUPERADMIN_EMAIL:-superadmin@tibusride.local}"
SUPABASE_PASSWORD="${LOCAL_SUPERADMIN_PASSWORD:-TibusRide-Local-2026!}"

DOCKER_BIN=""
for candidate in docker /usr/local/bin/docker /Applications/Docker.app/Contents/Resources/bin/docker; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" info >/dev/null 2>&1; then
    DOCKER_BIN="$candidate"
    break
  fi
  if [[ -x "$candidate" ]] && "$candidate" info >/dev/null 2>&1; then
    DOCKER_BIN="$candidate"
    break
  fi
done

if [[ -z "$DOCKER_BIN" ]]; then
  if [[ -d /Applications/Docker.app ]]; then
    echo "❌ Docker Desktop est installé mais le moteur n'est pas démarré."
    echo ""
    echo "   1. Ouvrez Docker Desktop (Applications → Docker)"
    echo "   2. Attendez « Engine running » (baleine fixe en haut à droite)"
    echo "   3. Première fois : acceptez les conditions + connexion compte Docker"
    echo "   4. Docker Desktop → Settings → General → cochez « Start Docker Desktop when you log in »"
    echo "   5. Relancez : npm run supabase:local"
    echo ""
    echo "   Test manuel : /Applications/Docker.app/Contents/Resources/bin/docker info"
  else
    echo "❌ Docker Desktop n'est pas installé."
    echo "   https://docs.docker.com/desktop/setup/install/mac-install/"
  fi
  exit 1
fi

if ! docker info >/dev/null 2>&1 && [[ -n "$DOCKER_BIN" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:$PATH"
fi

if ! docker info >/dev/null 2>&1; then
  echo "❌ Impossible de joindre le moteur Docker."
  exit 1
fi

echo "▶ supabase start"
supabase start --workdir "${ROOT}"

echo "▶ supabase db reset"
supabase db reset --yes --workdir "${ROOT}"

STATUS_JSON="$(supabase status --workdir "${ROOT}" -o json)"
API_URL="$(printf '%s' "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['API_URL'])")"
ANON_KEY="$(printf '%s' "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['ANON_KEY'])")"
SERVICE_KEY="$(printf '%s' "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")"
PROJECT_REF="$(printf '%s' "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['PROJECT_ID'])")"

echo "▶ Compte superadmin : ${SUPABASE_EMAIL}"
SIGNUP_JSON="$(curl -sS -X POST "${API_URL}/auth/v1/signup" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${SUPABASE_EMAIL}\",\"password\":\"${SUPABASE_PASSWORD}\",\"data\":{\"full_name\":\"Super Admin Local\"}}")"

USER_ID="$(printf '%s' "$SIGNUP_JSON" | python3 <<'PY'
import sys, json
d = json.load(sys.stdin)
uid = (d.get("user") or {}).get("id") or d.get("id")
if uid:
    print(uid)
    raise SystemExit(0)
msg = json.dumps(d)
if "already" in msg.lower():
    raise SystemExit(10)
raise SystemExit("Signup failed: " + msg)
PY
)" || {
  code=$?
  if [[ "$code" -eq 10 ]]; then
    SIGNIN_JSON="$(curl -sS -X POST "${API_URL}/auth/v1/token?grant_type=password" \
      -H "apikey: ${ANON_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"${SUPABASE_EMAIL}\",\"password\":\"${SUPABASE_PASSWORD}\"}")"
    USER_ID="$(printf '%s' "$SIGNIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")"
  else
    exit 1
  fi
}

echo "▶ Rôle superadmin pour ${USER_ID}"
supabase db query --workdir "${ROOT}" --local --sql "
DELETE FROM public.user_roles WHERE user_id = '${USER_ID}'::uuid;
INSERT INTO public.user_roles (user_id, role) VALUES ('${USER_ID}'::uuid, 'superadmin');
UPDATE public.profiles SET full_name = 'Super Admin Local', country = NULL WHERE id = '${USER_ID}'::uuid;
"

cat > "${ROOT}/.env.local" <<EOF
# tibus-frontend — Supabase LOCAL
SUPABASE_URL=${API_URL}
SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
SUPABASE_PROJECT_ID=${PROJECT_REF}
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
VITE_SUPABASE_PROJECT_ID=${PROJECT_REF}
VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY=
VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID=
EOF

echo ""
echo "✅ Prêt. Depuis tibus-frontend : npm run dev"
echo "   Studio  : http://127.0.0.1:54323"
echo "   Login   : ${SUPABASE_EMAIL} / ${SUPABASE_PASSWORD}"
