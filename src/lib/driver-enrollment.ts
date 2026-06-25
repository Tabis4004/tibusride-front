import type { Category } from "@/lib/pricing";

export type PartnerType = "ride" | "delivery";
export type VehicleType = "car" | "motorcycle" | "van" | "tricycle" | "two_wheel";
export type EnrollmentDocKind = "license" | "vehicle" | "vehicle_condition" | "insurance";

/** Colonne driver_profiles correspondant à chaque type de document. */
export const DOC_COLUMN: Record<EnrollmentDocKind, string> = {
  license: "license_document_url",
  vehicle: "vehicle_document_url",
  vehicle_condition: "vehicle_condition_url",
  insurance: "insurance_document_url",
};

export const PARTNER_TYPES: { value: PartnerType; label: string; description: string }[] = [
  { value: "ride", label: "Chauffeur (courses)", description: "Transport de passagers — taxi, éco, confort…" },
  { value: "delivery", label: "Livreur", description: "Colis et repas — deux-roues, moto, tricycle, voiture" },
];

export const VEHICLE_TYPES: { value: VehicleType; label: string; forPartner: PartnerType[] }[] = [
  { value: "two_wheel", label: "Deux-roues", forPartner: ["delivery"] },
  { value: "motorcycle", label: "Moto", forPartner: ["ride", "delivery"] },
  { value: "tricycle", label: "Tricycle", forPartner: ["delivery"] },
  { value: "car", label: "Voiture", forPartner: ["ride", "delivery"] },
  { value: "van", label: "Fourgonnette", forPartner: ["delivery"] },
];

/** Catégories assignables après contrôle physique (chauffeur courses). */
export const RIDE_CATEGORIES: { value: Category; label: string }[] = [
  { value: "taxi", label: "Taxi" },
  { value: "eco", label: "Éco" },
  { value: "confort", label: "Confort" },
  { value: "confort_plus", label: "Confort +" },
  { value: "vip", label: "VIP" },
];

export { DELIVERY_ASSIGNMENT_CATEGORIES as DELIVERY_CATEGORIES } from "@/lib/delivery-pricing";

export const ENROLLMENT_DOCS: { kind: EnrollmentDocKind; label: string; hint: string }[] = [
  { kind: "license", label: "Permis de conduire", hint: "Photo ou scan lisible (recto/verso si nécessaire)" },
  { kind: "vehicle", label: "Carte grise", hint: "Document officiel du véhicule ou de la moto" },
  { kind: "insurance", label: "Assurance", hint: "Attestation d'assurance en cours de validité" },
  { kind: "vehicle_condition", label: "État du véhicule / moto", hint: "Photos récentes : extérieur, intérieur, plaque visible" },
];

export function enrollmentProgress(profile: {
  license_document_url?: string | null;
  vehicle_document_url?: string | null;
  vehicle_condition_url?: string | null;
  insurance_document_url?: string | null;
  insurance_expires_at?: string | null;
  city?: string | null;
  license_number?: string | null;
  vehicle_type?: string | null;
  partner_type?: string | null;
  avatar_url?: string | null;
}): { done: number; total: number; complete: boolean } {
  const checks = [
    !!profile.avatar_url,
    !!profile.partner_type,
    !!profile.vehicle_type,
    !!profile.city?.trim(),
    !!profile.license_number?.trim(),
    !!profile.license_document_url,
    !!profile.vehicle_document_url,
    !!profile.vehicle_condition_url,
    !!profile.insurance_document_url,
    !!profile.insurance_expires_at,
  ];
  const done = checks.filter(Boolean).length;
  return { done, total: checks.length, complete: done === checks.length };
}

/** Statut de validation de l'assurance par l'assureur. */
export type InsuranceStatus = "pending" | "verified" | "expired";

export const INSURANCE_STATUS_LABEL: Record<InsuranceStatus, string> = {
  pending: "En attente de validation",
  verified: "Validée par l'assureur",
  expired: "Expirée",
};
