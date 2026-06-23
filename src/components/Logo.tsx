import logoAsset from "@/assets/tibus-logo.png.asset.json";
import { useCountryMarketOptional } from "@/hooks/use-country-market";
import { isEcoTibus, marketAppName } from "@/lib/country-market";

/** URL Lovable (/__l5e/...) indisponible hors Lovable Cloud — on affiche le texte seul. */
const logoSrc = logoAsset.url.includes("/__l5e/") ? null : logoAsset.url;

export function Logo({
  size = 32,
  compact = false,
  appName,
}: {
  size?: number;
  compact?: boolean;
  appName?: string;
}) {
  const market = useCountryMarketOptional();
  const name = appName ?? marketAppName(market?.config);
  const eco = isEcoTibus(market?.config);
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {logoSrc && !eco ? (
        <img
          src={logoSrc}
          alt={name}
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="object-contain"
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground"
          style={{ width: size, height: size }}
        >
          {initial}
        </span>
      )}
      {!compact && (
        <span className="font-display text-xl font-bold tracking-tight text-foreground">
          {name}
        </span>
      )}
    </div>
  );
}
