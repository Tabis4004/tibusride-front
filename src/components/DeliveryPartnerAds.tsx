import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Megaphone, UtensilsCrossed } from "lucide-react";
import { getDeliveryPartnersForCity } from "@/lib/delivery-partners";
import { toast } from "sonner";

type Props = {
  city: string;
};

const VISIBLE_COUNT = 3;

export function DeliveryPartnerAds({ city }: Props) {
  const partners = getDeliveryPartnersForCity(city);
  const [expanded, setExpanded] = useState(false);

  if (partners.length === 0) return null;

  const hasMore = partners.length > VISIBLE_COUNT;
  const visible = expanded ? partners : partners.slice(0, VISIBLE_COUNT);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Megaphone className="h-4 w-4 text-primary" />
          Offres livraison
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Espace partenaire</span>
      </div>

      {/* Pile verticale qui s'adapte à la largeur de l'écran — pas de défilement horizontal */}
      <div className="flex flex-col gap-3">
        {visible.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => toast.info(`Livraison ${p.name} — bientôt dans l'app Tibus`)}
            className={`relative flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br ${p.gradient} p-4 text-left text-white shadow-md transition-transform active:scale-[0.98]`}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-sm font-bold leading-tight">{p.name}</span>
                {p.badge && (
                  <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
                    {p.badge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-white/80">{p.cuisine}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">{p.promo}</span>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-white/70">
                  <Clock className="h-3 w-3" />
                  {p.etaMin} min
                </span>
              </div>
            </div>
          </button>
        ))}

        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border bg-muted/40 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/70"
          >
            {expanded ? (
              <>
                Voir moins
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Voir plus ({partners.length - VISIBLE_COUNT})
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}

        <div className="flex w-full flex-col items-center rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-center">
          <div className="text-xs font-semibold text-foreground">Vous êtes restaurateur ?</div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Souscrivez à Tibus Delivery et apparaissez ici.
          </p>
          <span className="mt-2 text-[10px] font-medium text-primary">Contact commercial →</span>
        </div>
      </div>
    </section>
  );
}
