import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Annonces vocales du workflow chauffeur, pré-générées via une API cloud TTS
 * (Google Cloud Text-to-Speech) et mises en cache dans le bucket Storage
 * `tts-announcements`. But : contourner totalement la dépendance au moteur
 * TTS du téléphone (peu fiable sur certains Android, notamment Huawei sans
 * Google Play Services) — le téléphone se contente de jouer un MP3, ce qui
 * fonctionne dans n'importe quel WebView.
 *
 * Liste fermée (whitelist) : on ne génère jamais de texte arbitraire côté
 * serveur, pour éviter un abus qui ferait gonfler la facture de l'API cloud.
 * Pour ajouter une annonce, ajouter une clé ici + son texte, redéployer.
 */
export const ANNOUNCEMENT_TEXT = {
  new_ride_alert: "Vous avez une commande",
  ride_accepted: "Course acceptée",
  driver_arriving: "Vous arrivez",
  ride_started: "Course démarrée",
  ride_completed: "Course terminée",
  ride_completed_thanks: "Merci d'avoir utilisé Tibus Ride, heureux de vous revoir bientôt",
} as const;

export type AnnouncementKey = keyof typeof ANNOUNCEMENT_TEXT;

const ANNOUNCEMENT_KEYS = Object.keys(ANNOUNCEMENT_TEXT) as AnnouncementKey[];

function getServerTtsKey(): string {
  const key = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GOOGLE_TTS_API_KEY manquante — créez une clé API dans Google Cloud Console avec l'API Cloud Text-to-Speech activée.",
    );
  }
  return key;
}

/**
 * Renvoie l'URL publique du MP3 mis en cache pour cette annonce. Si le
 * fichier n'existe pas encore dans le bucket, le génère via Google Cloud TTS
 * puis l'y stocke — donc un seul appel payant par phrase, pour toujours.
 */
export const getAnnouncementAudioUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(ANNOUNCEMENT_KEYS as [AnnouncementKey, ...AnnouncementKey[]]) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${data.key}.mp3`;

    const { data: pub } = supabaseAdmin.storage.from("tts-announcements").getPublicUrl(path);
    const existsRes = await fetch(pub.publicUrl, { method: "HEAD" }).catch(() => null);
    if (existsRes?.ok) {
      return { ok: true as const, url: pub.publicUrl };
    }

    try {
      const apiKey = getServerTtsKey();
      const text = ANNOUNCEMENT_TEXT[data.key];
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: "fr-FR", ssmlGender: "FEMALE" },
          audioConfig: { audioEncoding: "MP3" },
        }),
      });
      const json: any = await res.json();
      if (!res.ok || !json.audioContent) {
        return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}` };
      }
      const buf = Buffer.from(json.audioContent, "base64");
      const { error: uploadErr } = await supabaseAdmin.storage
        .from("tts-announcements")
        .upload(path, buf, { contentType: "audio/mpeg", upsert: true });
      if (uploadErr) return { ok: false as const, error: uploadErr.message };
      return { ok: true as const, url: pub.publicUrl };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Erreur TTS inconnue" };
    }
  });
