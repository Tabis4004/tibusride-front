import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { placeDetails, placesAutocomplete } from "@/lib/maps.functions";
import { Loader2, MapPin } from "lucide-react";

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
  className?: string;
  inputId?: string;
}

export function AddressAutocomplete({ value, onChange, onSelect, placeholder, bias, inputId }: Props) {
  const autocompleteFn = useServerFn(placesAutocomplete);
  const detailsFn = useServerFn(placeDetails);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const skipNextFetchRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch
  useEffect(() => {
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (value.trim().length < 2) { setItems([]); setOpen(false); return; }
    const t = setTimeout(() => {
      setLoading(true);
      autocompleteFn({ data: { input: value, bias } })
        .then((r) => {
          if (r.ok) {
            // Rank: prefer those with distance, ascending, otherwise original order
            const sorted = [...r.suggestions].sort((a, b) => {
              if (a.distanceMeters != null && b.distanceMeters != null) return a.distanceMeters - b.distanceMeters;
              if (a.distanceMeters != null) return -1;
              if (b.distanceMeters != null) return 1;
              return 0;
            });
            setItems(sorted.slice(0, 6));
            setOpen(true);
            setActive(-1);
          }
        })
        .finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [value, bias?.lat, bias?.lng]);

  // Click outside closes
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = async (s: Suggestion) => {
    setOpen(false);
    skipNextFetchRef.current = true;
    onChange(s.full || `${s.primary}${s.secondary ? ", " + s.secondary : ""}`);
    const r = await detailsFn({ data: { placeId: s.placeId } });
    if (r.ok) {
      skipNextFetchRef.current = true;
      onChange(r.formatted || s.full);
      onSelect({ lat: r.lat, lng: r.lng, formatted: r.formatted || s.full });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative flex-1">
      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && items.length > 0 && (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-popover shadow-lg">
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
    </div>
  );
}
