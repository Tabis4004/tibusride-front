import { createFileRoute } from "@tanstack/react-router";
import { buildSessionCookie, verifySessionToken } from "@/integrations/vercel/auth";

export const Route = createFileRoute("/api/auth/set-session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        const redirectTo = url.searchParams.get("redirect") ?? "/app";

        if (!token) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/auth?error=Session%20invalide" },
          });
        }

        const session = await verifySessionToken(token);
        if (!session) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/auth?error=Session%20expir%C3%A9e" },
          });
        }

        const secure = url.protocol === "https:";
        const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/app";

        return new Response(null, {
          status: 302,
          headers: {
            Location: safeRedirect,
            "Set-Cookie": buildSessionCookie(token, secure),
          },
        });
      },
    },
  },
});
