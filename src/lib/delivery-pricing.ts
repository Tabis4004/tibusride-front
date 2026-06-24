import { formatXof } from "@/lib/pricing";
import { DEFAULT_DYNAMIC_COEFFICIENTS, type DynamicCoefficients, type WeatherKind } from "@/lib/dynamic-pricing";

/** Véhicules livraison — même logique base + km + min que les courses voiture. */
export type DeliveryVehicle = "two_wheel" | "motorcycle" | "tricycle" | "car" | "van";

export type PackageType = "documents" | "small" | "medium" | "large" | "food" | "fragile";

export const DELIVERY_VEHICLES: Record<
  DeliveryVehicle,
  { label: string; emoji: string; base: number; perKm: number; perMin: number; eta: string }
> = {
  two_wheel: { label: "Deux-roues", emoji: "🚲", base: 400, perKm: 175, perMin: 26, eta: "15-25 min" },
  motorcycle: { label: "Moto", emoji: "🏍️", base: 500, perKm: 220, perMin: 32, eta: "12-20 min" },
  tricycle: { label: "Tricycle", emoji: "🛺", base: 600, perKm: 240, perMin: 35, eta: "15-25 min" },
  car: { label: "Voiture", emoji: "🚗", base: 800, perKm: 280, perMin: 40, eta: "20-35 min" },
  van: { label: "Fourgon", emoji: "🚐", base: 1200, perKm: 350, perMin: 48, eta: "25-40 min" },
};

export const PACKAGE_TYPES: Record<
  PackageType,
  { label: string; emoji: string; hint: string; multiplier: number }
> = {
  documents: { label: "Documents", emoji: "📄", hint: "Enveloppe, dossier léger", multiplier: 1 },
  small: { label: "Petit colis", emoji: "📦", hint: "Jusqu'à 5 kg", multiplier: 1 },
  medium: { label: "Colis moyen", emoji: "📦", hint: "5 à 15 kg", multiplier: 1.15 },
  large: { label: "Grand colis", emoji: "🧳", hint: "15 kg et plus", multiplier: 1.35 },
  food: { label: "Repas / alimentaire", emoji: "🍱", hint: "Nourriture, boissons", multiplier: 1.1 },
  fragile: { label: "Fragile", emoji: "⚠️", hint: "Manipulation soignée", multiplier: 1.2 },
};

export const DELIVERY_EXTRAS = {
  urgent: { label: "Livraison urgente", fee: 800, description: "Priorité maximale — +25 % en plus" },
  insulated_bag: { label: "Sac isotherme", fee: 350, description: "Maintien température repas / produits frais" },
} as const;

export type DeliveryPriceBreakdown = {
  base: number;
  distance: number;
  duration: number;
  packageSurcharge: number;
  urgentFee: number;
  insulatedBagFee: number;
  trafficSurcharge: number;
  weatherSurcharge: number;
  subtotal: number;
  total: number;
  factors: {
    trafficIndex: number;
    trafficLabel: string;
    weatherKind: WeatherKind;
    weatherLabel: string;
    packageLabel: string;
  };
};

export type DeliveryVehicleRates = { base: number; perKm: number; perMin: number };

export type DeliveryPriceInput = {
  vehicle: DeliveryVehicle;
  packageType: PackageType;
  km: number;
  durationMin: number;
  staticDurationMin?: number;
  weather?: WeatherKind;
  urgent?: boolean;
  insulatedBag?: boolean;
  /** Tarifs de base (DB) ; défaut = DELIVERY_VEHICLES codées en dur si non fourni. */
  rates?: DeliveryVehicleRates;
  /** Coefficients trafic/météo (DB) ; défaut = anciennes constantes si non fourni. */
  coefficients?: DynamicCoefficients;
};

/** Tarif livraison dynamique (distance + durée + trafic + météo + colis + options). */
export function computeDeliveryPrice(input: DeliveryPriceInput): DeliveryPriceBreakdown {
  const {
    vehicle,
    packageType,
    km,
    durationMin,
    staticDurationMin,
    weather = "sunny",
    urgent = false,
    insulatedBag = false,
  } = input;

  const v = input.rates ?? DELIVERY_VEHICLES[vehicle];
  const coef = input.coefficients ?? DEFAULT_DYNAMIC_COEFFICIENTS;
  const pkg = PACKAGE_TYPES[packageType];
  const base = v.base;
  const distance = Math.round(km * v.perKm);
  const duration = Math.round(durationMin * v.perMin);
  const lineSubtotal = base + distance + duration;
  const packageSurcharge = Math.round(lineSubtotal * (pkg.multiplier - 1));

  const staticMin = Math.max(1, staticDurationMin ?? durationMin);
  const trafficRatio = durationMin / staticMin;
  const trafficIndex = Math.max(1, Math.min(coef.trafficRatioCap, trafficRatio));
  const trafficSurcharge = Math.round((lineSubtotal + packageSurcharge) * (trafficIndex - 1) * coef.trafficCoefficient);

  const weatherMultiplier =
    weather === "rainy" ? coef.weatherRainyMultiplier
    : weather === "cloudy" ? coef.weatherCloudyMultiplier
    : coef.weatherSunnyMultiplier;
  const weatherSurcharge = Math.round((lineSubtotal + packageSurcharge) * (weatherMultiplier - 1));

  let urgentFee = urgent ? DELIVERY_EXTRAS.urgent.fee : 0;
  if (urgent) urgentFee += Math.round((lineSubtotal + packageSurcharge) * 0.25);

  const insulatedBagFee = insulatedBag ? DELIVERY_EXTRAS.insulated_bag.fee : 0;

  const subtotal = lineSubtotal + packageSurcharge + trafficSurcharge + weatherSurcharge;
  const raw = subtotal + urgentFee + insulatedBagFee;
  const total = Math.round(raw / coef.roundingIncrementXof) * coef.roundingIncrementXof;

  const trafficPct = Math.round((trafficIndex - 1) * 100);
  const trafficLabel =
    trafficPct <= 0 ? "Fluide"
    : trafficPct < 15 ? "Trafic léger"
    : trafficPct < 30 ? "Trafic modéré"
    : "Trafic dense";

  const weatherLabel =
    weather === "rainy" ? "Pluvieux"
    : weather === "cloudy" ? "Nuageux"
    : "Ensoleillé";

  return {
    base,
    distance,
    duration,
    packageSurcharge,
    urgentFee,
    insulatedBagFee,
    trafficSurcharge,
    weatherSurcharge,
    subtotal,
    total,
    factors: {
      trafficIndex,
      trafficLabel,
      weatherKind: weather,
      weatherLabel,
      packageLabel: pkg.label,
    },
  };
}

export function estimateDeliveryWaitMin(vehicle: DeliveryVehicle, trafficIndex = 1): number {
  const eta = DELIVERY_VEHICLES[vehicle].eta;
  const base = parseInt(eta.split("-")[0], 10) || 12;
  return Math.min(20, Math.round(base * Math.max(1, trafficIndex * 0.85)));
}

/** Catégories admin livreur alignées sur le véhicule. */
export const DELIVERY_ASSIGNMENT_CATEGORIES = (Object.keys(DELIVERY_VEHICLES) as DeliveryVehicle[]).map((k) => ({
  value: `delivery_${k}`,
  label: `Livraison — ${DELIVERY_VEHICLES[k].label}`,
  vehicle: k,
}));

export function deliveryCategoryForVehicle(vehicle: DeliveryVehicle): string {
  return `delivery_${vehicle}`;
}

export function vehicleFromAssignedCategory(cat: string | null | undefined): DeliveryVehicle | null {
  if (!cat?.startsWith("delivery_")) return null;
  const v = cat.replace("delivery_", "") as DeliveryVehicle;
  return v in DELIVERY_VEHICLES ? v : null;
}

export function formatDeliverySummary(b: DeliveryPriceBreakdown): string {
  return `${b.factors.packageLabel} · ${formatXof(b.total)}`;
}
