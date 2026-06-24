import type { Category } from "@/lib/pricing";

/**
 * Illustrations de véhicules en pseudo-3D (vue 3/4, dégradés + reflets) pour
 * remplacer les emoji 🚕🚗🚙🚘🏎️ jugés amateurs. Une couleur de carrosserie
 * différente par catégorie, cohérente avec le positionnement tarifaire
 * (du plus accessible "Taxi" au plus haut de gamme "VIP").
 */

type CarStyle = {
  body: [string, string]; // dégradé carrosserie [clair, foncé]
  accent: string; // bande / liseré distinctif
  roofLong: boolean; // silhouette plus longue/basse (berline premium)
};

const STYLES: Record<Category, CarStyle> = {
  taxi: { body: ["#ffd54a", "#e8a800"], accent: "#1c1c1c", roofLong: false },
  eco: { body: ["#5fd98a", "#1f9e5c"], accent: "#0d6b3c", roofLong: false },
  confort: { body: ["#6fb3ff", "#2f7fe0"], accent: "#1e4f99", roofLong: false },
  confort_plus: { body: ["#aab4c2", "#5c6878"], accent: "#2b3340", roofLong: true },
  vip: { body: ["#3a3f47", "#0e1014"], accent: "#d4af37", roofLong: true },
};

export function CarIcon({ category, className }: { category: Category; className?: string }) {
  const s = STYLES[category];
  const gradId = `car-body-${category}`;
  const glassId = `car-glass-${category}`;

  return (
    <svg viewBox="0 0 64 40" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.body[0]} />
          <stop offset="100%" stopColor={s.body[1]} />
        </linearGradient>
        <linearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eaf6ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#9fd3f0" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* Ombre au sol */}
      <ellipse cx="32" cy="35" rx="26" ry="3.2" fill="#000" opacity="0.18" />

      {/* Carrosserie */}
      <path
        d={
          s.roofLong
            ? "M6 28 C6 22 9 19 14 18 L20 12 C22 10 25 9 29 9 L41 9 C45 9 48 10 50 12 L56 18 C60 19 62 22 62 26 L62 28 C62 31 60 33 57 33 L9 33 C7 33 6 30.5 6 28 Z"
            : "M5 27 C5 21 9 18 15 17 L19 11 C21 9 24 8 28 8 L38 8 C42 8 45 9 47 11 L51 17 C57 18 60 21 60 26 L60 28 C60 31 58 33 55 33 L7 33 C6 33 5 30 5 27 Z"
        }
        fill={`url(#${gradId})`}
        stroke="#00000022"
        strokeWidth="0.5"
      />

      {/* Reflet supérieur (effet 3D) */}
      <path
        d={
          s.roofLong
            ? "M14 18 C18 14 23 10.5 29 10 L41 10 C46 10.5 50 14 54 18 L50 17 C46 13 42 11 38 11 L29 11 C25 11 21 13 18 17 Z"
            : "M15 17 C18 13 22 9.5 28 9 L38 9 C43 9.5 47 13 50 17 L46 16 C43 12.5 39 10.5 36 10 L28 10 C24 10.5 20.5 12.5 18 16 Z"
        }
        fill="#ffffff"
        opacity="0.22"
      />

      {/* Vitres */}
      <path
        d={
          s.roofLong
            ? "M21 17 L24 12 C25.5 10.5 27.5 10 29.5 10 L40.5 10 C42.5 10 44.5 10.5 46 12 L49 17 Z"
            : "M20 16 L23 11 C24.5 9.5 26.5 9 28.5 9 L37.5 9 C39.5 9 41.5 9.5 43 11 L46 16 Z"
        }
        fill={`url(#${glassId})`}
      />
      {/* Montant central */}
      <line x1="35" y1={s.roofLong ? 10 : 9} x2="35" y2="17" stroke={s.accent} strokeWidth="0.9" opacity="0.5" />

      {/* Bande accent carrosserie */}
      <rect x="6" y="24" width="56" height="2" fill={s.accent} opacity={category === "taxi" ? 1 : 0.55} rx="1" />
      {category === "taxi" && (
        <>
          <rect x="26" y="20" width="12" height="3.4" rx="1" fill="#1c1c1c" />
          <rect x="26" y="20" width="12" height="3.4" rx="1" fill="#fff" opacity="0.08" />
        </>
      )}
      {category === "vip" && (
        <rect x="6" y="24.6" width="56" height="0.8" fill={s.accent} opacity="0.9" />
      )}

      {/* Phares */}
      <ellipse cx="58.5" cy="24" rx="1.6" ry="2.2" fill="#fff7d6" opacity="0.95" />
      <ellipse cx="7" cy="26.5" rx="1.4" ry="1.6" fill="#ff5b4d" opacity="0.85" />

      {/* Roues */}
      <circle cx="18" cy="33" r="5.4" fill="#16181c" />
      <circle cx="18" cy="33" r="2.6" fill="#9aa3ad" />
      <circle cx="48" cy="33" r="5.4" fill="#16181c" />
      <circle cx="48" cy="33" r="2.6" fill="#9aa3ad" />
    </svg>
  );
}
