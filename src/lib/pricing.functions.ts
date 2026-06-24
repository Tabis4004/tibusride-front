import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CATEGORIES, type Category } from "@/lib/pricing";
import { DELIVERY_VEHICLES, PACKAGE_TYPES, DELIVERY_EXTRAS, type DeliveryVehicle, type PackageType } from "@/lib/delivery-pricing";

/**
 * Configuration de tarification effective, lue en base — remplace les
 * constantes codées en dur de dynamic-pricing.ts / delivery-pricing.ts.
 *
 * - `categories` : base/km/min/min_fare par catégorie, depuis `pricing_settings`
 *   (table déjà existante, déjà éditable via l'onglet admin "Tarifs", mais
 *   jusqu'ici jamais lue au moment du calcul réel du prix).
 * - `dynamic` : coefficients trafic + météo, résolus par programme (sinon
 *   défaut global) via `resolve_dynamic_pricing_settings()`.
 *
 * Toujours retourne une config complète : si une catégorie n'a pas de ligne
 * active en base, on retombe sur les anciennes constantes de `pricing.ts`
 * pour ne jamais casser le calcul de prix.
 */
export type EffectiveCategoryRates = {
  base: number;
  perKm: number;
  perMin: number;
  minFare: number;
};

export type EffectiveDynamicCoefficients = {
  trafficCoefficient: number;
  trafficRatioCap: number;
  weatherRainyMultiplier: number;
  weatherCloudyMultiplier: number;
  weatherSunnyMultiplier: number;
  roundingIncrementXof: number;
};

export type EffectiveExtraFee = { feeXof: number; percentExtra: number };

export type EffectivePricingConfig = {
  categories: Record<Category, EffectiveCategoryRates>;
  deliveryVehicles: Record<DeliveryVehicle, EffectiveCategoryRates>;
  packageMultipliers: Record<PackageType, number>;
  deliveryExtras: { urgent: EffectiveExtraFee; insulated_bag: EffectiveExtraFee };
  dynamic: EffectiveDynamicCoefficients;
};

const FALLBACK_DYNAMIC: EffectiveDynamicCoefficients = {
  trafficCoefficient: 0.45,
  trafficRatioCap: 1.65,
  weatherRainyMultiplier: 1.12,
  weatherCloudyMultiplier: 1.05,
  weatherSunnyMultiplier: 1.0,
  roundingIncrementXof: 50,
};

export const getEffectivePricingConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ programId: z.string().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<EffectivePricingConfig> => {
    const { supabase } = context;

    // Base/km/min par catégorie — pricing_settings, fallback CATEGORIES si absent.
    const { data: rows } = await supabase
      .from("pricing_settings")
      .select("category, base_fare_xof, per_km_xof, per_min_xof, min_fare_xof, active")
      .eq("active", true);

    const categories = { ...defaultCategoryRates() };
    for (const row of rows ?? []) {
      const cat = row.category as Category;
      if (cat in categories) {
        categories[cat] = {
          base: row.base_fare_xof,
          perKm: row.per_km_xof,
          perMin: row.per_min_xof,
          minFare: row.min_fare_xof,
        };
      }
    }

    // Tarifs livraison — delivery_pricing_settings, fallback DELIVERY_VEHICLES si absent.
    const { data: deliveryRows } = await supabase
      .from("delivery_pricing_settings")
      .select("vehicle, base_fare_xof, per_km_xof, per_min_xof, min_fare_xof, active")
      .eq("active", true);

    const deliveryVehicles = { ...defaultDeliveryRates() };
    for (const row of deliveryRows ?? []) {
      const v = row.vehicle as DeliveryVehicle;
      if (v in deliveryVehicles) {
        deliveryVehicles[v] = {
          base: row.base_fare_xof,
          perKm: row.per_km_xof,
          perMin: row.per_min_xof,
          minFare: row.min_fare_xof,
        };
      }
    }

    // Multiplicateurs par type de colis — delivery_package_pricing, fallback PACKAGE_TYPES si absent.
    const { data: packageRows } = await supabase
      .from("delivery_package_pricing")
      .select("package_type, multiplier, active")
      .eq("active", true);

    const packageMultipliers = { ...defaultPackageMultipliers() };
    for (const row of packageRows ?? []) {
      const pt = row.package_type as PackageType;
      if (pt in packageMultipliers) packageMultipliers[pt] = Number(row.multiplier);
    }

    // Frais supplémentaires livraison (urgence, sac isotherme) — delivery_extras_pricing,
    // fallback DELIVERY_EXTRAS si absent.
    const { data: extraRows } = await supabase
      .from("delivery_extras_pricing")
      .select("extra_key, fee_xof, percent_extra, active")
      .eq("active", true);

    const deliveryExtras: { urgent: EffectiveExtraFee; insulated_bag: EffectiveExtraFee } = {
      urgent: { feeXof: DELIVERY_EXTRAS.urgent.fee, percentExtra: 25 },
      insulated_bag: { feeXof: DELIVERY_EXTRAS.insulated_bag.fee, percentExtra: 0 },
    };
    for (const row of extraRows ?? []) {
      if (row.extra_key === "urgent" || row.extra_key === "insulated_bag") {
        const key = row.extra_key as "urgent" | "insulated_bag";
        deliveryExtras[key] = { feeXof: row.fee_xof, percentExtra: Number(row.percent_extra) };
      }
    }

    // Coefficients trafic/météo — résolus par programme, sinon défaut global.
    const { data: dyn, error: dynError } = await supabase.rpc(
      "resolve_dynamic_pricing_settings",
      // Le paramètre SQL accepte NULL (fallback global) ; les types générés le
      // déclarent comme `string` non-nullable par limitation du générateur.
      { _program_id: data.programId ?? null } as { _program_id: string },
    );

    const dynamic: EffectiveDynamicCoefficients = dynError || !dyn
      ? FALLBACK_DYNAMIC
      : {
          trafficCoefficient: Number(dyn.traffic_coefficient ?? FALLBACK_DYNAMIC.trafficCoefficient),
          trafficRatioCap: Number(dyn.traffic_ratio_cap ?? FALLBACK_DYNAMIC.trafficRatioCap),
          weatherRainyMultiplier: Number(dyn.weather_rainy_multiplier ?? FALLBACK_DYNAMIC.weatherRainyMultiplier),
          weatherCloudyMultiplier: Number(dyn.weather_cloudy_multiplier ?? FALLBACK_DYNAMIC.weatherCloudyMultiplier),
          weatherSunnyMultiplier: Number(dyn.weather_sunny_multiplier ?? FALLBACK_DYNAMIC.weatherSunnyMultiplier),
          roundingIncrementXof: Number(dyn.rounding_increment_xof ?? FALLBACK_DYNAMIC.roundingIncrementXof),
        };

    return { categories, deliveryVehicles, packageMultipliers, deliveryExtras, dynamic };
  });

function defaultCategoryRates(): Record<Category, EffectiveCategoryRates> {
  const out = {} as Record<Category, EffectiveCategoryRates>;
  for (const key of Object.keys(CATEGORIES) as Category[]) {
    const c = CATEGORIES[key];
    out[key] = { base: c.base, perKm: c.perKm, perMin: c.perMin, minFare: 0 };
  }
  return out;
}

function defaultDeliveryRates(): Record<DeliveryVehicle, EffectiveCategoryRates> {
  const out = {} as Record<DeliveryVehicle, EffectiveCategoryRates>;
  for (const key of Object.keys(DELIVERY_VEHICLES) as DeliveryVehicle[]) {
    const v = DELIVERY_VEHICLES[key];
    out[key] = { base: v.base, perKm: v.perKm, perMin: v.perMin, minFare: 0 };
  }
  return out;
}

function defaultPackageMultipliers(): Record<PackageType, number> {
  const out = {} as Record<PackageType, number>;
  for (const key of Object.keys(PACKAGE_TYPES) as PackageType[]) {
    out[key] = PACKAGE_TYPES[key].multiplier;
  }
  return out;
}
