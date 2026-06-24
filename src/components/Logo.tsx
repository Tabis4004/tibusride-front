/** Logo de marque unique (flamme) : nom et icône fixes "Tibus Ride" partout dans l'app. */
const logoSrc = "/pwa/icon-512.png";
const APP_NAME = "Tibus Ride";

export function Logo({
  size = 32,
  compact = false,
  appName,
}: {
  size?: number;
  compact?: boolean;
  appName?: string;
}) {
  const name = appName ?? APP_NAME;

  return (
    <div className="flex items-center gap-2">
      <img
        src={logoSrc}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="object-contain"
      />
      {!compact && (
        <span className="font-display text-xl font-bold tracking-tight text-foreground">
          {name}
        </span>
      )}
    </div>
  );
}
