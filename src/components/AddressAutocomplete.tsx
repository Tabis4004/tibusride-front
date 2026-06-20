import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { placeDetails, placesAutocomplete } from "@/lib/maps.functions";
import { AlertCircle, CheckCircle2, Loader2, MapPin, Navigation2 } from "lucide-react";

type Suggestion = {
  placeId: string;
  primary: string;
  secondary: string;
  full: string;
  distanceMeters: number | null;
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: { lat: number; lng: number; formatted: string }) => void;
  placeholder?: string;
  bias?: { lat: number; lng: number; radiusMeters?: number };
  regionCode?: string;
  resolved?: boolean;
  nearbyOption?: { title: string; subtitle?: string; lat: number; lng: number; formatted: string };
  className?: string;
  inputId?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  bias,
  regionCode,
  resolved = false,
  nearbyOption,
  inputId,
}: Props) {
  const autocompleteFn = useServerFn(placesAutocomplete);
  const detailsFn = useServerFn(placeDetails);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [active, setActive] = useState(-1);
  const [apiError, setApiError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const skipNextFetchRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (value.trim().length < 2) {
      setItems([]);
      setOpen(false);
      setApiError(null);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      setApiError(null);
      setPickError(null);
      autocompleteFn({ data: { input: value, bias, regionCode } })
        .then((r) => {
          if (r.ok) {
            const sorted = [...r.suggestions].sort((a, b) => {
              if (a.distanceMeters != null && b.distanceMeters != null) return a.distanceMeters - b.distanceMeters;
              if (a.distanceMeters != null) return -1;
              if (b.distanceMeters != null) return 1;
              return 0;
            });
            setItems(sorted.slice(0, 8));
            setOpen(sorted.length > 0);
            setActive(-1);
            if (sorted.length === 0) {
              setApiError("Aucune adresse trouvée — affinez votre recherche ou cliquez sur la carte.");
            }
          } else {
            setItems([]);
            setOpen(false);
            setApiError(r.error ?? "Suggestions indisponibles — cliquez sur la carte pour placer le point.");
          }
        })
        .catch(() => {
          setItems([]);
          setOpen(false);
          setApiError("Suggestions indisponibles — cliquez sur la carte pour placer le point.");
        })
        .finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [value, bias?.lat, bias?.lng, regionCode, autocompleteFn]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pickNearby = () => {
    if (!nearbyOption) return;
    setOpen(false);
    setPickError(null);
    skipNextFetchRef.current = true;
    onChange(nearbyOption.formatted);
    onSelect({ lat: nearbyOption.lat, lng: nearbyOption.lng, formatted: nearbyOption.formatted });
  };

  const pick = async (s: Suggestion) => {
    setOpen(false);
    setPickError(null);
    skipNextFetchRef.current = true;
    onChange(s.full || `${s.primary}${s.secondary ? ", " + s.secondary : ""}`);
    setResolving(true);
    try {
      const r = await detailsFn({ data: { placeId: s.placeId } });
      if (r.ok) {
        skipNextFetchRef.current = true;
        onChange(r.formatted || s.full);
        onSelect({ lat: r.lat, lng: r.lng, formatted: r.formatted || s.full });
      } else {
        setPickError("Impossible de localiser cette adresse — choisissez une autre suggestion.");
      }
    } catch {
      setPickError("Impossible de localiser cette adresse — choisissez une autre suggestion.");
    } finally {
      setResolving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const showUnresolvedHint = value.trim().length >= 2 && !resolved && !loading && !resolving;

  return (
    <div ref={wrapRef} className="relative flex-1 space-y-1">
      <div className="relative">
        <Input
          id={inputId}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setPickError(null);
          }}
          placeholder={placeholder}
          maxLength={200}
          onFocus={() => (items.length > 0 || nearbyOption) && setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className={showUnresolvedHint ? "border-amber-500/70 pr-9" : resolved ? "border-success/60 pr-9" : "pr-9"}
          aria-invalid={showUnresolvedHint}
        />
        {(loading || resolving) && (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && !resolving && resolved && (
          <CheckCircle2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
        )}
      </div>

      {open && (nearbyOption || items.length > 0) && (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-popover shadow-lg">
          {nearbyOption && (
            <li className="border-b border-border">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pickNearby(); }}
                className="flex w-full items-start gap-2 bg-success/5 px-3 py-2.5 text-left text-sm hover:bg-success/10"
              >
                <Navigation2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{nearbyOption.title}</div>
                  {nearbyOption.subtitle && (
                    <div className="truncate text-xs text-muted-foreground">{nearbyOption.subtitle}</div>
                  )}
                </div>
              </button>
            </li>
          )}
          {items.length > 0 && (
            <li className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Adresses Google — sélectionnez un point précis
            </li>
          )}
          {items.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                onMouseEnter={() => setActive(i)}
                className={[
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                ].join(" ")}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.primary}</div>
                  {s.secondary && <div className="truncate text-xs text-muted-foreground">{s.secondary}</div>}
                </div>
                {s.distanceMeters != null && (
                  <span className="shrink-0 self-center text-[10px] text-muted-foreground">
                    {s.distanceMeters < 1000 ? `${Math.round(s.distanceMeters)} m` : `${(s.distanceMeters / 1000).toFixed(1)} km`}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showUnresolvedHint && (
        <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          Choisissez une adresse dans la liste pour fixer le point sur la carte.
        </p>
      )}
      {(apiError || pickError) && (
        <p className="flex items-start gap-1 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {pickError ?? apiError}
        </p>
      )}
    </div>
  );
}
