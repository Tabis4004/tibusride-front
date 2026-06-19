import logoAsset from "@/assets/tibus-logo.png.asset.json";

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <img
        src={logoAsset.url}
        alt="Tibus Ride"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="object-contain"
      />
      <span className="font-display text-xl font-bold tracking-tight text-foreground">
        Tibus Ride
      </span>
    </div>
  );
}
