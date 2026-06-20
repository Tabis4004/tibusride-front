import logoAsset from "@/assets/tibus-logo.png.asset.json";

/** URL Lovable (/__l5e/...) indisponible hors Lovable Cloud — on affiche le texte seul. */
const logoSrc = logoAsset.url.includes("/__l5e/") ? null : logoAsset.url;

export function Logo({ size = 32, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {logoSrc ? (
        <img
          src={logoSrc}
          alt="Tibus Ride"
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
          T
        </span>
      )}
      {!compact && (
        <span className="font-display text-xl font-bold tracking-tight text-foreground">
          Tibus Ride
        </span>
      )}
    </div>
  );
}
