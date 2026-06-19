import { createServerFn } from "@tanstack/react-start";
import { getRequest, getResponseHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getUserRoles,
  parseCookieHeader,
  createPasswordResetToken,
  resetUserPassword,
  sessionCookieName,
  signInUser,
  signUpUser,
  verifyPasswordResetToken,
  verifySessionToken,
} from "@/integrations/vercel/auth";
import { optionalAuth, requireAuth } from "@/integrations/vercel/auth-middleware";
import { serviceQuery } from "@/integrations/vercel/db";
import { createClient } from "@supabase/supabase-js";
import { sendPasswordResetEmail } from "@/lib/email";
import { exchangeGoogleCodeForSession } from "@/lib/google-auth.server";

function redirectWithSession(sessionToken: string) {
  return `/api/auth/set-session?token=${encodeURIComponent(sessionToken)}&redirect=${encodeURIComponent("/app")}`;
}

function isSecureRequest() {
  const request = getRequest();
  return request?.url.startsWith("https://") === true || process.env.NODE_ENV === "production";
}

function appendSessionCookie(token: string) {
  getResponseHeaders()?.append("Set-Cookie", buildSessionCookie(token, isSecureRequest()));
}

function appendClearSessionCookie() {
  getResponseHeaders()?.append("Set-Cookie", clearSessionCookie(isSecureRequest()));
}

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

export const getSession = createServerFn({ method: "GET" })
  .middleware([optionalAuth])
  .handler(async ({ context }) => {
    if (!context.userId) return { user: null, roles: [] as string[] };
    const roles = await getUserRoles(context.userId);
    return {
      user: { id: context.userId, email: context.email ?? "" },
      roles,
    };
  });

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        full_name: z.string().min(2).max(80),
        phone: z.string().min(8).max(20),
        role: z.enum(["passenger", "driver"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await signUpUser(data);
    const token = await createSessionToken(user);
    appendSessionCookie(token);
    const roles = await getUserRoles(user.id);
    return { user, roles, sessionToken: token, redirectUrl: redirectWithSession(token) };
  });

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await signInUser(data.email, data.password);
    const token = await createSessionToken(user);
    appendSessionCookie(token);
    const roles = await getUserRoles(user.id);
    return { user, roles, sessionToken: token, redirectUrl: redirectWithSession(token) };
  });

export const signInWithGoogleCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ code: z.string().min(1), redirect_uri: z.string().url() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { user, sessionToken } = await exchangeGoogleCodeForSession(
      data.code,
      data.redirect_uri,
    );
    appendSessionCookie(sessionToken);
    const roles = await getUserRoles(user.id);
    return {
      user: { id: user.id, email: user.email },
      roles,
      sessionToken,
      redirectUrl: redirectWithSession(sessionToken),
    };
  });

export const signInWithGoogle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ access_token: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("Supabase non configuré (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY).");
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error } = await supabase.auth.getUser(data.access_token);
    if (error || !userData.user?.email) {
      throw new Error("Session Google invalide ou expirée.");
    }

    const user = userData.user;
    await ensureUserBootstrap(user);

    const token = await createSessionToken({ id: user.id, email: user.email });
    appendSessionCookie(token);
    const roles = await getUserRoles(user.id);
    return { user: { id: user.id, email: user.email }, roles };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  appendClearSessionCookie();
  return { ok: true };
});

function isSupabaseConfigured() {
  const url = process.env.SUPABASE_URL ?? "";
  return url.includes(".supabase.co") && !url.includes("[") && !url.includes("VOTRE");
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), origin: z.string().url() }).parse(d),
  )
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();

    if (isSupabaseConfigured()) {
      const url = process.env.SUPABASE_URL!;
      const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${data.origin}/auth/reset-password`,
      });
      return {
        ok: true,
        message: "Si un compte existe, un email de réinitialisation a été envoyé.",
      };
    }

    const rows = await serviceQuery<{ id: string; encrypted_password: string | null }>(
      `SELECT id, encrypted_password FROM auth.users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const row = rows[0];

    if (row && !row.encrypted_password) {
      return {
        ok: true,
        message: "Ce compte utilise Google. Connectez-vous avec « Continuer avec Google ».",
      };
    }

    if (row?.encrypted_password) {
      const token = await createPasswordResetToken(row.id);
      const resetUrl = `${data.origin}/auth/reset-password?token=${encodeURIComponent(token)}`;
      const emailResult = await sendPasswordResetEmail({ to: email, resetUrl });

      if (emailResult.sent) {
        return {
          ok: true,
          message: "Un email de réinitialisation a été envoyé si le compte existe.",
        };
      }

      console.log(`[Tibus Ride] Lien réinitialisation pour ${email}:\n${resetUrl}`);
      return {
        ok: true,
        message:
          "Pas de service email configuré — copiez le lien ci-dessous pour réinitialiser votre mot de passe.",
        resetUrl,
        emailConfigured: false,
      };
    }

    return {
      ok: true,
      message: "Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.",
      emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().min(1), password: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data }) => {
    const userId = await verifyPasswordResetToken(data.token);
    if (!userId) throw new Error("Lien invalide ou expiré. Demandez un nouveau lien.");
    await resetUserPassword(userId, data.password);
    return { ok: true };
  });

export const getAuthUserFromRequest = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const token = parseCookieHeader(request?.headers.get("cookie") ?? null, sessionCookieName());
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  return { id: session.id, email: session.email };
});

export const assertAdmin = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { hasRole } = await import("@/integrations/vercel/auth");
    const ok = await hasRole(context.userId, "admin");
    if (!ok) throw new Error("Forbidden: admin role required");
    return { ok: true };
  });
