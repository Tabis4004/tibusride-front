import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Tibus Ride" },
      {
        name: "description",
        content:
          "Contactez Tibus Ride par email ou WhatsApp pour toute question, assistance ou demande relative à vos données.",
      },
    ],
  }),
  component: Contact,
});

function Contact() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-foreground">Contact</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Une question sur l'application, votre compte, une course, ou notre{" "}
          <Link to="/confidentialite" className="text-primary underline">
            politique de confidentialité
          </Link>{" "}
          ? Vous pouvez nous joindre via les moyens suivants.
        </p>

        <div className="mt-8 space-y-4">
          <div className="rounded-lg border border-border/60 p-4">
            <h2 className="font-display text-base font-semibold text-foreground">Email</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <a href="mailto:tabistibus@gmail.com" className="text-primary underline">
                tabistibus@gmail.com
              </a>
            </p>
          </div>

          <div className="rounded-lg border border-border/60 p-4">
            <h2 className="font-display text-base font-semibold text-foreground">WhatsApp</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <a href="https://wa.me/2250172960000" className="text-primary underline">
                +225 01 72 96 00 00
              </a>
            </p>
          </div>
        </div>

        <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
          Nous nous efforçons de répondre à toute demande dans les meilleurs délais.
        </p>
      </main>
    </div>
  );
}
