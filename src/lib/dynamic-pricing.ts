import {
  CATEGORIES,
  formatXof,
  type Category,
  type PriceBreakdown,
} from "@/lib/pricing";

export type WeatherKind = "sunny" | "rainy" | "cloudy";

export type DynamicPriceBreakdown = PriceBreakdown & {
  subtotal: number;
  trafficSurcharge: number;
  weatherSurcharge: number;
  factors: {
    trafficIndex: number;
    trafficLabel: string;
    weatherKind: WeatherKind;
    weatherLabel: string;
  };
};

/** Tarifs de base par catégorie — résolus depuis pricing_settings (DB), avec
 * repli sur CATEGORIES si la config n'a pas pu être chargée. */
export type CategoryRates = { base: number; perKm: number; perMin: number };

/** Coefficients trafic + météo — résolus depuis dynamic_pricing_settings (DB,
 * scoped par programme), avec repli sur les anciennes constantes. */
export type DynamicCoefficients = {
  trafficCoefficient: number;
  trafficRatioCap: number;
  weatherRainyMultiplier: number;
  weatherCloudyMultiplier: number;
  weatherSunnyMultiplier: number;
  roundingIncrementXof: number;
};

export const DEFAULT_DYNAMIC_COEFFICIENTS: DynamicCoefficients = {
  trafficCoefficient: 0.45,
  trafficRatioCap: 1.65,
  weatherRainyMultiplier: 1.12,
  weatherCloudyMultiplier: 1.05,
  weatherSunnyMultiplier: 1.0,
  roundingIncrementXof: 50,
};

export type DynamicPriceInput = {
  category: Category;
  km: number;
  durationMin: number;
  staticDurationMin?: number;
  weather?: WeatherKind;
  /** Tarifs de base (DB) ; défaut = CATEGORIES codées en dur si non fourni. */
  rates?: CategoryRates;
  /** Coefficients trafic/météo (DB) ; défaut = anciennes constantes si non fourni. */
  coefficients?: DynamicCoefficients;
};

/** Tarif dynamique : distance + durée + trafic + météo (combinaison des 4 facteurs). */
export function computeDynamicPrice(input: DynamicPriceInput): DynamicPriceBreakdown {
  const { category, km, durationMin, staticDurationMin, weather = "sunny" } = input;
  const c = input.rates ?? CATEGORIES[category];
  const coef = input.coefficients ?? DEFAULT_DYNAMIC_COEFFICIENTS;
  const base = c.base;
  const distance = Math.round(km * c.perKm);
  const duration = Math.round(durationMin * c.perMin);
  const subtotal = base + distance + duration;

  const staticMin = Math.max(1, staticDurationMin ?? durationMin);
  const trafficRatio = durationMin / staticMin;
  const trafficIndex = Math.max(1, Math.min(coef.trafficRatioCap, trafficRatio));
  const trafficSurcharge = Math.round(subtotal * (trafficIndex - 1) * coef.trafficCoefficient);

  const weatherMultiplier =
    weather === "rainy" ? coef.weatherRainyMultiplier
    : weather === "cloudy" ? coef.weatherCloudyMultiplier
    : coef.weatherSunnyMultiplier;
  const weatherSurcharge = Math.round(subtotal * (weatherMultiplier - 1));

  const raw = subtotal + trafficSurcharge + weatherSurcharge;
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
    delivery: 0,
    subtotal,
    trafficSurcharge,
    weatherSurcharge,
    total,
    factors: {
      trafficIndex,
      trafficLabel,
      weatherKind: weather,
      weatherLabel,
    },
  };
}

export function formatDynamicFactors(b: DynamicPriceBreakdown): string {
  return `${b.factors.trafficLabel} · ${b.factors.weatherLabel} · ${formatXof(b.total)}`;
}

/** Temps d'attente chauffeur estimé (recherche) selon catégorie et trafic. */
export function estimateDriverWaitMin(category: Category, trafficIndex = 1): number {
  const eta = CATEGORIES[category].eta;
  const base = parseInt(eta.split("-")[0], 10) || 4;
  return Math.min(15, Math.round(base * Math.max(1, trafficIndex * 0.85)));
}
