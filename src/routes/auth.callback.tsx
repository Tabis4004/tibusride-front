import { createFileRoute } from "@tanstack/react-router";
import { buildSessionCookie } from "@/integrations/vercel/auth";
import { exchangeGoogleCodeForSession } from "@/lib/google-auth.server";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const oauthError =
          url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (oauthError) {
          return redirectToAuth(oauthError);
        }

        const code = url.searchParams.get("code");
        if (!code) {
          return redirectToAuth("Aucun code Google reçu.");
        }

        try {
          const redirectUri = `${url.origin}/auth/callback`;
          const { sessionToken } = await exchangeGoogleCodeForSession(code, redirectUri);
          const secure = url.protocol === "https:";

          return new Response(null, {
            status: 302,
            headers: {
              Location: "/app",
              "Set-Cookie": buildSessionCookie(sessionToken, secure),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Connexion Google impossible";
          console.error("[Tibus Ride] Google callback:", message);
          return redirectToAuth(message);
        }
      },
    },
  },
  head: () => ({ meta: [{ title: "Connexion Google — Tibus Ride" }] }),
  component: AuthCallbackFallback,
});

function redirectToAuth(message: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: `/auth?error=${encodeURIComponent(message)}` },
  });
}

function AuthCallbackFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sunset px-4">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Connexion avec Google…</p>
      </div>
    </div>
  );
}
