import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendContactMessage } from "@/lib/contact.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Tibus Ride" },
      {
        name: "description",
        content:
          "Contactez Tibus Ride par email, WhatsApp ou via le formulaire de contact pour toute question, assistance ou demande relative à vos données.",
      },
    ],
  }),
  component: Contact,
});

const formSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  email: z.string().trim().email("Email invalide"),
  message: z.string().trim().min(10, "Message trop court (10 caractères minimum)").max(4000),
});

function Contact() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "");
    const email = String(fd.get("email") ?? "");
    const message = String(fd.get("message") ?? "");
    const honeypot = String(fd.get("company") ?? "");

    const parsed = formSchema.safeParse({ name, email, message });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const result = await sendContactMessage({ data: { ...parsed.data, honeypot } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Message envoyé ! Nous vous répondrons rapidement.");
      setSent(true);
      e.currentTarget.reset();
    } catch {
      toast.error("Échec de l'envoi. Réessayez ou contactez-nous par email/WhatsApp ci-dessous.");
    } finally {
      setLoading(false);
    }
  };

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
          ? Écrivez-nous via le formulaire ci-dessous, ou directement par email/WhatsApp.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4 rounded-lg border border-border/60 p-4 sm:p-6">
          {/* Honeypot anti-spam : champ invisible pour un humain, masqué hors flux visuel */}
          <div className="absolute -left-[9999px]" aria-hidden="true">
            <label htmlFor="company">Entreprise</label>
            <input type="text" id="company" name="company" tabIndex={-1} autoComplete="off" />
          </div>

          <div>
            <Label htmlFor="name">Nom</Label>
            <Input id="name" name="name" required maxLength={100} className="mt-1" disabled={loading} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required maxLength={200} className="mt-1" disabled={loading} />
          </div>
          <div>
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              name="message"
              required
              minLength={10}
              maxLength={4000}
              rows={5}
              className="mt-1"
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Envoi…" : "Envoyer"}
          </Button>
          {sent && (
            <p className="text-sm text-muted-foreground">
              Merci, votre message a bien été envoyé.
            </p>
          )}
        </form>

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
