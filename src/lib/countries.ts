/** Pays canoniques (admin, RLS, matching chauffeur/passager). */
export const SERVICE_COUNTRIES = [
  "Sénégal",
  "Côte d'Ivoire",
  "Togo",
  "Bénin",
  "Niger",
  "Nigeria",
  "Mali",
  "Burkina Faso",
  "Ghana",
  "Guinée",
] as const;

export type ServiceCountry = (typeof SERVICE_COUNTRIES)[number];

const COUNTRY_ALIASES: Record<string, ServiceCountry> = {
  Senegal: "Sénégal",
  Benin: "Bénin",
  "Cote d'Ivoire": "Côte d'Ivoire",
  Guinee: "Guinée",
};

export function normalizeCountry(value: string | null | undefined): ServiceCountry | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if ((SERVICE_COUNTRIES as readonly string[]).includes(trimmed)) {
    return trimmed as ServiceCountry;
  }
  return COUNTRY_ALIASES[trimmed] ?? null;
}

export function countriesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCountry(a);
  const nb = normalizeCountry(b);
  if (na && nb) return na === nb;
  return (a ?? null) === (b ?? null);
}

export function assertServiceCountry(value: string): ServiceCountry {
  const c = normalizeCountry(value);
  if (!c) throw new Error(`Pays « ${value} » non reconnu.`);
  return c;
}
