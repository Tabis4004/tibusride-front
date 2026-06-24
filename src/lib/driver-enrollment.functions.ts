import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DOC_COLUMN, type EnrollmentDocKind } from "@/lib/driver-enrollment";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

async function uploadDriverDoc(
  userId: string,
  kind: EnrollmentDocKind,
  filename: string,
  contentType: string,
  base64: string,
) {
  if (!ALLOWED_TYPES.includes(contentType)) {
    throw new Error("Format non supporté (JPG, PNG, WEBP ou PDF).");
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.byteLength > 5 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 5 Mo).");

  const ext = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: upErr } = await supabaseAdmin.storage
    .from("driver-documents")
    .upload(path, buf, { contentType, upsert: true });
  if (upErr) throw new Error(upErr.message);

  const col = DOC_COLUMN[kind];
  const { error: updErr } = await supabaseAdmin
    .from("driver_profiles")
    .update({ [col]: path, updated_at: new Date().toISOString() } as Record<string, string>)
    .eq("user_id", userId);
  if (updErr) throw new Error(updErr.message);
  return path;
}

/** Chauffeur / livreur : téléverse ses propres documents. */
export const uploadMyDriverDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      kind: z.enum(["license", "vehicle", "vehicle_condition", "insurance"]),
      filename: z.string().max(200),
      contentType: z.string().max(100),
      base64: z.string().max(8_000_000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("driver_profiles").select("status").eq("user_id", userId).maybeSingle();
    if (!prof) throw new Error("Créez d'abord votre profil partenaire.");
    if (prof.status === "approved") throw new Error("Compte déjà validé — contactez l'administration pour modifier les documents.");
    const path = await uploadDriverDoc(userId, data.kind, data.filename, data.contentType, data.base64);
    return { ok: true as const, path };
  });

/** URL signée pour consulter son propre document. */
export const getMyDocumentSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ path: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!data.path.startsWith(`${userId}/`)) throw new Error("Accès refusé à ce document.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("driver-documents")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/** Met à jour les informations d'enrôlement (avant validation). */
export const updateMyEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      partner_type: z.enum(["ride", "delivery"]),
      vehicle_type: z.enum(["car", "motorcycle", "van", "tricycle", "two_wheel"]),
      city: z.string().trim().min(1).max(80),
      license_number: z.string().trim().min(3).max(50),
      vehicle_plate: z.string().trim().max(30).optional(),
      vehicle_model: z.string().trim().max(80).optional(),
      vehicle_color: z.string().trim().max(40).optional(),
      insurance_expires_at: z.string().trim().min(1).max(10).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("driver_profiles").select("status").eq("user_id", userId).maybeSingle();
    if (!prof) throw new Error("Profil partenaire introuvable.");
    if (prof.status === "approved") throw new Error("Compte déjà validé.");
    const { error } = await supabase.from("driver_profiles").update({
      partner_type: data.partner_type,
      vehicle_type: data.vehicle_type,
      city: data.city,
      license_number: data.license_number,
      vehicle_plate: data.vehicle_plate ?? null,
      vehicle_model: data.vehicle_model ?? null,
      vehicle_color: data.vehicle_color ?? null,
      insurance_expires_at: data.insurance_expires_at ?? null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

/** Renouvellement de l'assurance par le chauffeur : remet le dossier en
 *  attente de validation par l'assureur (insurance_status -> 'pending'). */
export const renewMyInsurance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ expires_at: z.string().trim().min(1).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("renew_my_insurance", { _expires_at: data.expires_at });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Soumet le dossier pour vérification physique + catégorisation admin. */
export const submitEnrollmentForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof, error: fetchErr } = await supabase
      .from("driver_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!prof) throw new Error("Profil partenaire introuvable.");

    const missing: string[] = [];
    if (!prof.partner_type) missing.push("type de partenaire");
    if (!prof.vehicle_type) missing.push("type de véhicule");
    if (!prof.city?.trim()) missing.push("ville");
    if (!prof.license_number?.trim()) missing.push("n° permis");
    if (!prof.license_document_url) missing.push("permis de conduire");
    if (!prof.vehicle_document_url) missing.push("carte grise");
    if (!prof.insurance_document_url) missing.push("assurance");
    if (!prof.insurance_expires_at) missing.push("date d'expiration assurance");
    if (!prof.vehicle_condition_url) missing.push("photos état véhicule/moto");
    if (missing.length) {
      throw new Error(`Dossier incomplet : ${missing.join(", ")}.`);
    }

    const { error } = await supabase.from("driver_profiles").update({
      status: "under_review",
      enrollment_submitted_at: new Date().toISOString(),
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
