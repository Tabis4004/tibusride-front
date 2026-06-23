import { useCountryMarket } from "@/hooks/use-country-market";
import { marketAppName } from "@/lib/country-market";
import { cn } from "@/lib/utils";

/**
 * Sélecteur visible uniquement quand un pays héberge plusieurs programmes
 * (ex. Sénégal : Eco Tibus coopératif + Tibus Ride standard). Ne s'affiche
 * pas ailleurs — un seul programme actif = rien à choisir.
 */
export function MarketProgramSwitcher({ className }: { className?: string }) {
  const { programs, config, setProgramId } = useCountryMarket();

  if (programs.length < 2) return null;

  return (
    <div className={cn("flex gap-1.5 rounded-full bg-muted/50 p-1", className)}>
      {programs.map((p) => {
        const active = p.programId === config?.programId;
        return (
          <button
            key={p.programId}
            type="button"
            onClick={() => setProgramId(p.programId)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {marketAppName(p)}
          </button>
        );
      })}
    </div>
  );
}
