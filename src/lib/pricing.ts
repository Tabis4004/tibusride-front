import { normalizeCountry, type ServiceCountry } from "@/lib/countries";

// Tibus Ride — catégories: Taxi (1-4 pass), Éco, Confort, Confort+, VIP.

export type Category = "taxi" | "eco" | "confort" | "confort_plus" | "vip";

export const CATEGORIES: Record<Category, { label: string; base: number; perKm: number; perMin: number; capacity: string; eta: string; emoji: string; description: string }> = {
  taxi:        { label: "Taxi",      base: 500,  perKm: 200, perMin: 30, capacity: "1-4 passagers", eta: "3-7 min",  emoji: "🚕", description: "Course partagée ou privée, jusqu'à 4 passagers" },
  eco:         { label: "Éco",       base: 700,  perKm: 240, perMin: 35, capacity: "1 passager",    eta: "4-8 min",  emoji: "🚗", description: "Économique, idéal pour les trajets solo" },
  confort:     { label: "Confort",   base: 1000, perKm: 320, perMin: 45, capacity: "1 passager",    eta: "4-9 min",  emoji: "🚙", description: "Véhicule récent, plus d'espace" },
  confort_plus:{ label: "Confort +", base: 1400, perKm: 420, perMin: 55, capacity: "1 passager",    eta: "5-10 min", emoji: "🚘", description: "Haut de gamme, chauffeur expérimenté" },
  vip:         { label: "VIP",       base: 2200, perKm: 600, perMin: 80, capacity: "1 passager",    eta: "6-12 min", emoji: "🏎️", description: "Berline premium avec service personnalisé" },
};

// Hash déterministe simple pour estimer une distance plausible à partir des adresses.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function estimateDistance(pickup: string, dropoff: string): number {
  if (!pickup || !dropoff) return 0;
  const seed = hashStr(pickup.toLowerCase() + "→" + dropoff.toLowerCase());
  const km = 1.5 + (seed % 2050) / 100;
  return Math.round(km * 10) / 10;
}

export function estimateDuration(km: number): number {
  return Math.max(5, Math.round((km / 22) * 60));
}

export function estimatePrice(category: Category, km: number, min: number, deliveryFee = 0): number {
  const c = CATEGORIES[category];
  const raw = c.base + km * c.perKm + min * c.perMin + deliveryFee;
  return Math.round(raw / 50) * 50;
}

export type PriceBreakdown = {
  base: number;
  distance: number;
  duration: number;
  delivery: number;
  total: number;
};

export function getPriceBreakdown(category: Category, km: number, min: number, deliveryFee = 0): PriceBreakdown {
  const c = CATEGORIES[category];
  const base = c.base;
  const distance = Math.round(km * c.perKm);
  const duration = Math.round(min * c.perMin);
  const delivery = deliveryFee;
  const total = Math.round((base + distance + duration + delivery) / 50) * 50;
  return { base, distance, duration, delivery, total };
}

export function formatXof(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

// Zones de service : centre de la ville + rayon couvert (km).
export type ServiceZone = { value: string; country: string; countryCode: string; lat: number; lng: number; radiusKm: number; districts: string[] };

export const CITIES: ServiceZone[] = [
  { value: "Dakar",       country: "Sénégal",        countryCode: "SN", lat: 14.7167, lng: -17.4677, radiusKm: 25, districts: ["Plateau", "Médina", "Almadies", "Yoff", "Ouakam", "Mermoz", "Sacré-Cœur", "Point E", "Parcelles Assainies", "Pikine", "Guédiawaye"] },
  { value: "Abidjan",     country: "Côte d'Ivoire",  countryCode: "CI", lat: 5.3600,  lng: -4.0083,  radiusKm: 30, districts: ["Plateau", "Cocody", "Marcory", "Treichville", "Yopougon", "Abobo", "Adjamé", "Koumassi", "Port-Bouët"] },
  { value: "Lomé",        country: "Togo",           countryCode: "TG", lat: 6.1319,  lng:  1.2228,  radiusKm: 20, districts: ["Centre", "Tokoin", "Bè", "Adidogomé", "Agoè"] },
  { value: "Cotonou",     country: "Bénin",          countryCode: "BJ", lat: 6.3703,  lng:  2.3912,  radiusKm: 22, districts: ["Cadjèhoun", "Akpakpa", "Ganhi", "Dantokpa", "Fidjrossè"] },
  { value: "Niamey",      country: "Niger",          countryCode: "NE", lat: 13.5117, lng:  2.1251,  radiusKm: 18, districts: ["Plateau", "Yantala", "Gamkalé", "Lazaret", "Goudel"] },
  { value: "Bamako",      country: "Mali",           countryCode: "ML", lat: 12.6392, lng: -8.0029,  radiusKm: 25, districts: ["ACI 2000", "Hamdallaye", "Badalabougou", "Faladié", "Magnambougou"] },
  { value: "Ouagadougou", country: "Burkina Faso",   countryCode: "BF", lat: 12.3714, lng: -1.5197,  radiusKm: 22, districts: ["Koulouba", "Zone du Bois", "Ouaga 2000", "Pissy", "Tampouy"] },
  { value: "Accra",       country: "Ghana",          countryCode: "GH", lat: 5.6037,  lng: -0.1870,  radiusKm: 30, districts: ["Osu", "Airport", "East Legon", "Adabraka", "Dansoman"] },
  { value: "Lagos",       country: "Nigeria",        countryCode: "NG", lat: 6.5244,  lng:  3.3792,  radiusKm: 40, districts: ["Ikeja", "Victoria Island", "Lekki", "Ikoyi", "Surulere", "Yaba"] },
  { value: "Abuja",       country: "Nigeria",        countryCode: "NG", lat: 9.0579,  lng:  7.4951,  radiusKm: 25, districts: ["Wuse", "Garki", "Maitama", "Asokoro", "Gwarinpa"] },
  { value: "Conakry",     country: "Guinée",         countryCode: "GN", lat: 9.6412,  lng: -13.5784, radiusKm: 22, districts: ["Kaloum", "Dixinn", "Ratoma", "Matam", "Matoto"] },
];

export function getServiceZone(city: string): ServiceZone | undefined {
  return CITIES.find((c) => c.value === city);
}

/** Ville de service la plus proche d'un point GPS. */
export function nearestServiceCity(point: { lat: number; lng: number }): string {
  let best = CITIES[0];
  let bestKm = Infinity;
  for (const c of CITIES) {
    const d = haversineKm({ lat: c.lat, lng: c.lng }, point);
    if (d < bestKm) {
      bestKm = d;
      best = c;
    }
  }
  return best.value;
}

/** Ville principale d'un pays de service. */
export function defaultCityForCountry(country: string | null | undefined): string | undefined {
  const norm = normalizeCountry(country);
  if (!norm) return undefined;
  return CITIES.find((c) => c.country === norm)?.value;
}

/** Ville la plus proche dans le pays de l'utilisateur (sinon globale). */
export function nearestServiceCityInCountry(
  point: { lat: number; lng: number },
  country: string | null | undefined,
): string | undefined {
  const norm = normalizeCountry(country);
  const pool = norm ? CITIES.filter((c) => c.country === norm) : [];
  if (pool.length === 0) return undefined;
  let best = pool[0];
  let bestKm = Infinity;
  for (const c of pool) {
    const d = haversineKm({ lat: c.lat, lng: c.lng }, point);
    if (d < bestKm) {
      bestKm = d;
      best = c;
    }
  }
  return best.value;
}

export type ResolveCityInput = {
  profileCity?: string | null;
  profileCountry?: string | null;
  gps?: { lat: number; lng: number } | null;
};

/** Ville par défaut : profil utilisateur, puis GPS dans son pays, puis GPS global. */
export function resolveServiceCity(input: ResolveCityInput): string {
  const profileCity = input.profileCity?.trim();
  if (profileCity && CITIES.some((c) => c.value === profileCity)) {
    if (input.gps) {
      const inCountry = nearestServiceCityInCountry(input.gps, input.profileCountry);
      const zone = getServiceZone(profileCity);
      if (zone && input.gps) {
        const d = haversineKm({ lat: zone.lat, lng: zone.lng }, input.gps);
        if (d <= zone.radiusKm * 1.5) return profileCity;
      }
      if (inCountry) return inCountry;
    } else {
      return profileCity;
    }
  }

  const fromCountry = defaultCityForCountry(input.profileCountry);
  if (input.gps) {
    const inCountry = nearestServiceCityInCountry(input.gps, input.profileCountry);
    if (inCountry) return inCountry;
    return nearestServiceCity(input.gps);
  }
  if (fromCountry) return fromCountry;
  return CITIES[0].value;
}

export function countryForCity(city: string): ServiceCountry | undefined {
  return getServiceZone(city)?.country as ServiceCountry | undefined;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function isInServiceZone(city: string, point: { lat: number; lng: number } | null): { ok: boolean; distanceKm?: number; zone?: ServiceZone } {
  const zone = getServiceZone(city);
  if (!zone) return { ok: true };
  if (!point) return { ok: true, zone };
  const d = haversineKm({ lat: zone.lat, lng: zone.lng }, point);
  return { ok: d <= zone.radiusKm, distanceKm: d, zone };
}
