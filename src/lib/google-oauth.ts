/** Google OAuth direct (local, sans Supabase cloud). */

function isPlaceholder(value: string) {
  const v = value.trim();
  return !v || v.includes("[") || v.includes("VOTRE") || v === "eyJ..." || v.endsWith("...");
}

export function isSupabaseAuthConfigured(url?: string) {
  const u = (url ?? import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  return u.includes(".supabase.co") && !isPlaceholder(u) && !isPlaceholder(key);
}

export function isLocalGoogleConfigured() {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
  return id.length > 10 && !isPlaceholder(id);
}

/** Local Google OAuth si les clés .env sont présentes — prioritaire sur Supabase. */
export function shouldUseLocalGoogleOAuth() {
  return isLocalGoogleConfigured();
}

export function buildLocalGoogleAuthUrl(redirectUri: string) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("VITE_GOOGLE_CLIENT_ID manquant dans .env");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
