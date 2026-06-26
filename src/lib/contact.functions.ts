import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Server function PUBLIQUE (pas de middleware requireSupabaseAuth) : la page
// /contact doit fonctionner pour un visiteur non connecté.
//
// Utilise l'API REST de Resend directement via fetch (pas le SDK npm) pour
// éviter une dépendance supplémentaire. Nécessite la variable d'env
// RESEND_API_KEY (voir .env.example).
//
// IMPORTANT — sans domaine vérifié sur Resend, l'expéditeur "from" est
// forcé à onboarding@resend.dev et l'envoi n'est autorisé que vers l'email
// du compte Resend lui-même. Tant que CONTACT_RECIPIENT_EMAIL correspond à
// l'email du compte Resend (tabistibus@gmail.com), ça fonctionne sans
// configuration DNS supplémentaire.

const contactSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  email: z.string().trim().email("Email invalide"),
  message: z.string().trim().min(10, "Message trop court").max(4000),
  // Champ honeypot : invisible pour un humain (CSS), rempli uniquement par
  // les bots de spam qui remplissent tous les champs du formulaire.
  honeypot: z.string().max(0).optional().default(""),
});

export const sendContactMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => contactSchema.parse(d))
  .handler(async ({ data }) => {
    // Honeypot rempli → silencieusement "ok" pour ne pas indiquer au bot
    // que sa soumission a été rejetée.
    if (data.honeypot) {
      return { ok: true as const };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      console.error("[contact] RESEND_API_KEY manquante — email non envoyé");
      return {
        ok: false as const,
        error: "Le service d'envoi d'email n'est pas configuré. Contactez-nous directement par email ou WhatsApp.",
      };
    }

    const recipient = process.env.CONTACT_RECIPIENT_EMAIL?.trim() || "tabistibus@gmail.com";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tibus Ride <onboarding@resend.dev>",
        to: [recipient],
        reply_to: data.email,
        subject: `[Contact Tibus Ride] ${data.name}`,
        text: `Nouveau message via le formulaire de contact du site.\n\nNom : ${data.name}\nEmail : ${data.email}\n\nMessage :\n${data.message}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[contact] Resend a refusé l'envoi (HTTP ${res.status}) : ${body}`);
      return {
        ok: false as const,
        error: "Échec de l'envoi. Réessayez ou contactez-nous directement par email ou WhatsApp.",
      };
    }

    return { ok: true as const };
  });
