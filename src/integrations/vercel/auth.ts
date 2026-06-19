import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";

export type AuthUser = {
  id: string;
  email: string;
};

export type SessionPayload = AuthUser & {
  iat: number;
  exp: number;
};

const COOKIE_NAME = "tibus_session";
const SESSION_DAYS = 14;

function getSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Missing AUTH_SECRET (min 16 chars). Set it in Vercel Environment Variables.");
  }
  return new TextEncoder().encode(secret);
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: AuthUser) {
  return new SignJWT({ sub: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      id: payload.sub,
      email: payload.email,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export function parseCookieHeader(header: string | null, name: string) {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

export function buildSessionCookie(token: string, secure?: boolean) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const useSecure = secure ?? process.env.NODE_ENV === "production";
  const secureFlag = useSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

export function clearSessionCookie(secure?: boolean) {
  const useSecure = secure ?? process.env.NODE_ENV === "production";
  const secureFlag = useSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

export async function signUpUser(input: {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: "passenger" | "driver";
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await sql`SELECT id FROM auth.users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) throw new Error("Un compte existe déjà avec cet email.");

  const encrypted_password = await hashPassword(input.password);
  const raw_user_meta_data = {
    full_name: input.full_name,
    phone: input.phone,
    role: input.role,
  };

  const rows = await sql`
    INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
    VALUES (${email}, ${encrypted_password}, ${JSON.stringify(raw_user_meta_data)}::jsonb)
    RETURNING id, email
  `;
  const user = rows[0] as { id: string; email: string };
  return { id: user.id, email: user.email };
}

export async function signInUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const rows = await sql`
    SELECT id, email, encrypted_password
    FROM auth.users
    WHERE email = ${normalized}
    LIMIT 1
  `;
  const row = rows[0] as { id: string; email: string; encrypted_password: string | null } | undefined;
  if (!row?.encrypted_password) throw new Error("Identifiants incorrects");
  const ok = await verifyPassword(password, row.encrypted_password);
  if (!ok) throw new Error("Identifiants incorrects");
  return { id: row.id, email: row.email };
}

export async function createPasswordResetToken(userId: string) {
  return new SignJWT({ sub: userId, purpose: "password_reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(getSecret());
}

export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "password_reset" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function resetUserPassword(userId: string, password: string) {
  const encrypted_password = await hashPassword(password);
  const rows = await sql`
    UPDATE auth.users
    SET encrypted_password = ${encrypted_password}, updated_at = now()
    WHERE id = ${userId} AND encrypted_password IS NOT NULL
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new Error("Ce compte utilise Google. Connectez-vous avec Google.");
  }
}

export async function findOrCreateGoogleUser(input: {
  email: string;
  name?: string;
  picture?: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await sql`SELECT id, email FROM auth.users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    return existing[0] as { id: string; email: string };
  }

  const raw_user_meta_data = {
    full_name: input.name ?? email.split("@")[0],
    avatar_url: input.picture ?? null,
    role: "passenger",
  };

  const rows = await sql`
    INSERT INTO auth.users (email, raw_user_meta_data)
    VALUES (${email}, ${JSON.stringify(raw_user_meta_data)}::jsonb)
    RETURNING id, email
  `;
  return rows[0] as { id: string; email: string };
}

export async function getUserRoles(userId: string) {
  const rows = await sql`
    SELECT role FROM public.user_roles WHERE user_id = ${userId}
  `;
  return rows.map((r) => (r as { role: string }).role);
}

export async function hasRole(userId: string, role: string) {
  const rows = await sql`
    SELECT public.has_role(${userId}::uuid, ${role}::public.app_role) AS ok
  `;
  return Boolean((rows[0] as { ok: boolean } | undefined)?.ok);
}
