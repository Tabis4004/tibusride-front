import { Banknote, CreditCard, Smartphone, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCountry, SERVICE_COUNTRIES, type ServiceCountry } from "@/lib/countries";

/**
 * Couche "programme" : un pays peut héberger plusieurs offres commerciales
 * (ex. Sénégal = "Eco Tibus" coopératif + "Tibus Ride" VTC standard, en même temps).
 * Le nom de marque affiché vient de `branding.app_name` (donnée, pas du code) —
 * pour renommer ou marque-blanchir une offre, on édite la ligne en base, jamais le code.
 */
export type MarketProgram = "tibus_standard" | "eco_tibus";

export type MarketBranding = {
  app_name?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
  partners?: string[];
};

export type MarketFeatures = {
  delivery?: boolean;
  fair_dispatch?: boolean;
  insurance_module?: boolean;
  b2b_portal?: boolean;
  governance_panel?: boolean;
  electric_moto_bonus?: boolean;
  delivery_confirmation_photo?: boolean;
  stakeholder_driver_approval?: boolean;
};

export type MarketProgramConfig = {
  programId: string;
  country: string;
  programCode: MarketProgram;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  commissionDefault: number;
  commissionLocked: boolean;
  currency: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  authPhoneOtp: boolean;
  authEmail: boolean;
  branding: MarketBranding;
  features: MarketFeatures;
  dispatchMode: string;
  governanceMinNoticeDays: number;
};

export type MarketProgramRow = {
  program_id: string;
  country: string;
  program_code: MarketProgram;
  display_name: string;
  is_active: boolean;
  is_default?: boolean;
  commission_default: number;
  commission_locked: boolean;
  currency: string;
  default_language: string;
  supported_languages: string[];
  auth_phone_otp: boolean;
  auth_email: boolean;
  branding: unknown;
  features: unknown;
  dispatch_mode: string;
  governance_min_notice_days: number;
};

export type CountryPaymentProvider = {
  id: string;
  program_id: string;
  provider_code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

export type PaymentMethodValue = "mobile_money" | "cash" | "card";

export type CountryPaymentOption = {
  value: PaymentMethodValue;
  label: string;
  providerCode: string;
  icon: LucideIcon;
  hint?: string;
};

const DEFAULT_BRANDING: MarketBranding = {
  app_name: "Tibus Ride",
  tagline: "VTC pour l'Afrique de l'Ouest",
};

const SENEGAL_ECO_TIBUS_FALLBACK: MarketProgramConfig = {
  programId: "sn-eco_tibus",
  country: "Sénégal",
  programCode: "eco_tibus",
  displayName: "Eco Tibus",
  isActive: true,
  isDefault: true,
  commissionDefault: 10,
  commissionLocked: true,
  currency: "XOF",
  defaultLanguage: "fr",
  supportedLanguages: ["fr", "wo", "ar"],
  authPhoneOtp: true,
  authEmail: true,
  branding: {
    app_name: "Eco Tibus",
    tagline: "Livraison éthique au Sénégal",
    partners: ["Eco Tibus", "LigdiCash"],
  },
  features: {
    delivery: true,
    governance_panel: true,
    electric_moto_bonus: true,
    delivery_confirmation_photo: true,
    stakeholder_driver_approval: true,
  },
  dispatchMode: "self_assign",
  governanceMinNoticeDays: 90,
};

const SENEGAL_STANDARD_FALLBACK: MarketProgramConfig = {
  programId: "sn-tibus_standard",
  country: "Sénégal",
  programCode: "tibus_standard",
  displayName: "Tibus Ride Sénégal",
  isActive: true,
  isDefault: false,
  commissionDefault: 20,
  commissionLocked: false,
  currency: "XOF",
  defaultLanguage: "fr",
  supportedLanguages: ["fr"],
  authPhoneOtp: false,
  authEmail: true,
  branding: { app_name: "Tibus Ride", tagline: "VTC standard au Sénégal" },
  features: { delivery: true },
  dispatchMode: "self_assign",
  governanceMinNoticeDays: 90,
};

function fallbackConfig(country: string): MarketProgramConfig {
  if (country === "Sénégal") return { ...SENEGAL_ECO_TIBUS_FALLBACK };
  return {
    programId: `${country}-tibus_standard`,
    country,
    programCode: "tibus_standard",
    displayName: `Tibus Ride — ${country}`,
    isActive: true,
    isDefault: true,
    commissionDefault: 20,
    commissionLocked: false,
    currency: "XOF",
    defaultLanguage: "fr",
    supportedLanguages: ["fr"],
    authPhoneOtp: false,
    authEmail: true,
    branding: DEFAULT_BRANDING,
    features: { delivery: true },
    dispatchMode: "self_assign",
    governanceMinNoticeDays: 90,
  };
}

const FALLBACK_PROGRAMS: Record<string, MarketProgramConfig[]> = {
  Sénégal: [SENEGAL_ECO_TIBUS_FALLBACK, SENEGAL_STANDARD_FALLBACK],
};

const FALLBACK_PAYMENTS: Record<string, CountryPaymentOption[]> = {
  "sn-eco_tibus": [
    { value: "mobile_money", label: "LigdiCash", providerCode: "ligdicash", icon: Smartphone, hint: "Wave, Orange Money" },
    { value: "mobile_money", label: "Wave", providerCode: "wave", icon: Smartphone },
    { value: "mobile_money", label: "Orange Money", providerCode: "orange_money", icon: Smartphone },
    { value: "cash", label: "Espèces", providerCode: "cash", icon: Banknote },
  ],
  "sn-tibus_standard": [
    { value: "mobile_money", label: "Wave", providerCode: "wave", icon: Smartphone },
    { value: "mobile_money", label: "Orange Money", providerCode: "orange_money", icon: Smartphone },
    { value: "cash", label: "Espèces", providerCode: "cash", icon: Banknote },
  ],
};

const FALLBACK_PAYMENTS_BY_COUNTRY: Record<string, CountryPaymentOption[]> = {
  "Côte d'Ivoire": [
    { value: "mobile_money", label: "GeniusPay / Mobile Money", providerCode: "geniuspay", icon: Smartphone },
    { value: "cash", label: "Espèces", providerCode: "cash", icon: Banknote },
  ],
};

function parseBranding(raw: unknown): MarketBranding {
  if (!raw || typeof raw !== "object") return DEFAULT_BRANDING;
  return { ...DEFAULT_BRANDING, ...(raw as MarketBranding) };
}

function parseFeatures(raw: unknown): MarketFeatures {
  if (!raw || typeof raw !== "object") return {};
  return raw as MarketFeatures;
}

function mapProgramRow(row: MarketProgramRow): MarketProgramConfig {
  return {
    programId: row.program_id,
    country: row.country,
    programCode: row.program_code,
    displayName: row.display_name,
    isActive: row.is_active,
    isDefault: row.is_default ?? true,
    commissionDefault: Number(row.commission_default),
    commissionLocked: Boolean(row.commission_locked),
    currency: row.currency ?? "XOF",
    defaultLanguage: row.default_language ?? "fr",
    supportedLanguages: Array.isArray(row.supported_languages) ? row.supported_languages : ["fr"],
    authPhoneOtp: Boolean(row.auth_phone_otp),
    authEmail: Boolean(row.auth_email),
    branding: parseBranding(row.branding),
    features: parseFeatures(row.features),
    dispatchMode: row.dispatch_mode ?? "self_assign",
    governanceMinNoticeDays: Number(row.governance_min_notice_days ?? 90),
  };
}

function providerIcon(code: string): LucideIcon {
  if (code === "cash") return Banknote;
  if (code === "card") return CreditCard;
  return Smartphone;
}

function providerToPaymentMethod(code: string): PaymentMethodValue {
  if (code === "cash") return "cash";
  if (code === "card") return "card";
  return "mobile_money";
}

export function isEcoTibus(config: MarketProgramConfig | null | undefined): boolean {
  return config?.programCode === "eco_tibus";
}

export function marketAppName(config: MarketProgramConfig | null | undefined): string {
  return config?.branding?.app_name ?? config?.displayName ?? "Tibus Ride";
}

export function hasMarketFeature(config: MarketProgramConfig | null | undefined, key: keyof MarketFeatures): boolean {
  return !!config?.features?.[key];
}

export function resolveUserCountry(country: string | null | undefined): ServiceCountry {
  return normalizeCountry(country) ?? SERVICE_COUNTRIES[0];
}

/** Tous les programmes actifs d'un pays (ex. Sénégal -> [eco_tibus (défaut), tibus_standard]). */
export async function fetchMarketPrograms(country: string): Promise<MarketProgramConfig[]> {
  const normalized = resolveUserCountry(country);
  const { data, error } = await supabase.rpc("list_market_programs", { _country: normalized });

  if (error || !data?.length) {
    console.warn("[country-market] programs fallback", error?.message);
    return FALLBACK_PROGRAMS[normalized] ?? [fallbackConfig(normalized)];
  }
  return (data as MarketProgramRow[]).map(mapProgramRow);
}

/** Programme par défaut du pays (celui affiché tant que l'utilisateur n'a rien choisi). */
export async function fetchDefaultMarketProgram(country: string): Promise<MarketProgramConfig> {
  const normalized = resolveUserCountry(country);
  const { data, error } = await supabase.rpc("get_default_market_program", { _country: normalized });

  if (error || !data) {
    console.warn("[country-market] default program fallback", error?.message);
    return fallbackConfig(normalized);
  }
  return mapProgramRow(data as MarketProgramRow);
}

/** Un programme précis par son identifiant (ex. choix explicite dans un sélecteur). */
export async function fetchMarketProgram(programId: string): Promise<MarketProgramConfig | null> {
  const { data, error } = await supabase.rpc("get_market_program", { _program_id: programId });
  if (error || !data) {
    console.warn("[country-market] program fallback", error?.message);
    return null;
  }
  return mapProgramRow(data as MarketProgramRow);
}

export async function fetchProgramPaymentProviders(program: MarketProgramConfig): Promise<CountryPaymentOption[]> {
  const { data, error } = await supabase
    .from("country_payment_providers")
    .select("provider_code, label, sort_order, is_active")
    .eq("program_id", program.programId)
    .eq("is_active", true)
    .order("sort_order");

  if (error || !data?.length) {
    console.warn("[country-market] payment providers fallback", error?.message);
    return (
      FALLBACK_PAYMENTS[program.programId] ??
      FALLBACK_PAYMENTS_BY_COUNTRY[program.country] ?? [
        { value: "mobile_money", label: "Mobile Money", providerCode: "mobile_money", icon: Smartphone, hint: "Orange Money, Wave, MTN, Moov" },
        { value: "cash", label: "Espèces", providerCode: "cash", icon: Banknote },
        { value: "card", label: "Carte", providerCode: "card", icon: CreditCard },
      ]
    );
  }

  return (data as CountryPaymentProvider[]).map((p) => ({
    value: providerToPaymentMethod(p.provider_code),
    label: p.label,
    providerCode: p.provider_code,
    icon: providerIcon(p.provider_code),
  }));
}

export const marketProgramsQueryKey = (country: string) => ["market-programs", country] as const;
export const marketProgramPaymentsQueryKey = (programId: string) => ["market-program-payments", programId] as const;
