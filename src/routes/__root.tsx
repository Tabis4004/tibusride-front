import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La page que vous cherchez n'existe plus ou a été déplacée.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Cette page n'a pas pu se charger
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Une erreur est survenue. Réessayez ou revenez à l'accueil.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Accueil
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "Tibus Ride — VTC pour l'Afrique de l'Ouest" },
      { name: "description", content: "Commandez une voiture (Taxi, Éco, Confort, Confort+ ou VIP) à Dakar, Abidjan, Lomé, Cotonou, Niamey, Bamako, Ouagadougou, Accra, Lagos, Abuja et Conakry. Paiement Mobile Money, cash ou carte." },
      { name: "author", content: "Tibus Ride" },
      { property: "og:title", content: "Tibus Ride — VTC pour l'Afrique de l'Ouest" },
      { property: "og:description", content: "Commandez une voiture (Taxi, Éco, Confort, Confort+ ou VIP) à Dakar, Abidjan, Lomé, Cotonou, Niamey, Bamako, Ouagadougou, Accra, Lagos, Abuja et Conakry. Paiement Mobile Money, cash ou carte." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Tibus Ride — VTC pour l'Afrique de l'Ouest" },
      { name: "twitter:description", content: "Commandez une voiture (Taxi, Éco, Confort, Confort+ ou VIP) à Dakar, Abidjan, Lomé, Cotonou, Niamey, Bamako, Ouagadougou, Accra, Lagos, Abuja et Conakry. Paiement Mobile Money, cash ou carte." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a5a7e696-8968-4e8d-ae72-0c49c680a668/id-preview-fe1674df--f7c5ff36-5198-4850-82d6-16ad192725bf.lovable.app-1781869389661.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a5a7e696-8968-4e8d-ae72-0c49c680a668/id-preview-fe1674df--f7c5ff36-5198-4850-82d6-16ad192725bf.lovable.app-1781869389661.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
