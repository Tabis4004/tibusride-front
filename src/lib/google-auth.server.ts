import {
  createSessionToken,
  findOrCreateGoogleUser,
} from "@/integrations/vercel/auth";
import { serviceQuery } from "@/integrations/vercel/db";

async function ensureUserBootstrap(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const meta = user.user_metadata ?? {};
  const fullName =
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Utilisateur";
  const avatar =
    (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null;

  await serviceQuery(
    `INSERT INTO public.profiles (id, full_name, phone, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
       updated_at = now()`,
    [user.id, fullName, (meta.phone as string | undefined) ?? null, avatar],
  );

  await serviceQuery(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'passenger')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [user.id],
  );
}

export async function exchangeGoogleCodeForSession(code: string, redirectUri: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth non configuré (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description ?? tokenJson.error ?? "Échange Google échoué");
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profile = (await profileRes.json()) as { email?: string; name?: string; picture?: string };
  if (!profileRes.ok || !profile.email) {
    throw new Error("Impossible de lire l'email Google");
  }

  const user = await findOrCreateGoogleUser({
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  });

  await ensureUserBootstrap({
    id: user.id,
    email: user.email,
    user_metadata: { full_name: profile.name, picture: profile.picture },
  });

  const sessionToken = await createSessionToken({ id: user.id, email: user.email });
  return { user, sessionToken };
}
