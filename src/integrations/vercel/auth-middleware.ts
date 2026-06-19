import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { parseCookieHeader, sessionCookieName, verifySessionToken } from "@/integrations/vercel/auth";

export type AuthContext = {
  userId: string;
  email: string;
};

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request?.headers) throw new Error("Unauthorized: no request");

  const token = parseCookieHeader(request.headers.get("cookie"), sessionCookieName())
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? null;

  if (!token) throw new Error("Unauthorized: not signed in");

  const session = await verifySessionToken(token);
  if (!session) throw new Error("Unauthorized: invalid session");

  return next({
    context: {
      userId: session.id,
      email: session.email,
    } satisfies AuthContext,
  });
});

/** Optional auth — does not throw when logged out. */
export const optionalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const token = parseCookieHeader(request?.headers.get("cookie") ?? null, sessionCookieName());
  if (!token) return next({ context: { userId: null as string | null, email: null as string | null } });

  const session = await verifySessionToken(token);
  return next({
    context: {
      userId: session?.id ?? null,
      email: session?.email ?? null,
    },
  });
});
