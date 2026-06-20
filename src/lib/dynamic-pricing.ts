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

export type DynamicPriceInput = {
  category: Category;
  km: number;
  durationMin: number;
  staticDurationMin?: number;
  weather?: WeatherKind;
};

/** Tarif dynamique : distance + durée + trafic + météo (combinaison des 4 facteurs). */
export function computeDynamicPrice(input: DynamicPriceInput): DynamicPriceBreakdown {
  const { category, km, durationMin, staticDurationMin, weather = "sunny" } = input;
  const c = CATEGORIES[category];
  const base = c.base;
  const distance = Math.round(km * c.perKm);
  const duration = Math.round(durationMin * c.perMin);
  const subtotal = base + distance + duration;

  const staticMin = Math.max(1, staticDurationMin ?? durationMin);
  const trafficRatio = durationMin / staticMin;
  const trafficIndex = Math.max(1, Math.min(1.65, trafficRatio));
  const trafficSurcharge = Math.round(subtotal * (trafficIndex - 1) * 0.45);

  const weatherMultiplier = weather === "rainy" ? 1.12 : weather === "cloudy" ? 1.05 : 1;
  const weatherSurcharge = Math.round(subtotal * (weatherMultiplier - 1));

  const raw = subtotal + trafficSurcharge + weatherSurcharge;
  const total = Math.round(raw / 50) * 50;

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
