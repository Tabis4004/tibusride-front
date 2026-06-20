import { Clock, Megaphone, UtensilsCrossed } from "lucide-react";
import { getDeliveryPartnersForCity } from "@/lib/delivery-partners";
import { toast } from "sonner";

type Props = {
  city: string;
};

export function DeliveryPartnerAds({ city }: Props) {
  const partners = getDeliveryPartnersForCity(city);

  if (partners.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Megaphone className="h-4 w-4 text-primary" />
          Offres livraison
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Espace partenaire</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 scrollbar-none">
        {partners.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => toast.info(`Livraison ${p.name} — bientôt dans l'app Tibus`)}
            className={`relative min-w-[200px] max-w-[220px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br ${p.gradient} p-4 text-left text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]`}
          >
            {p.badge && (
              <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
                {p.badge}
              </span>
            )}
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
              <UtensilsCrossed className="h-4 w-4" />
            </div>
            <div className="mt-3 font-display text-sm font-bold leading-tight">{p.name}</div>
            <div className="mt-0.5 text-[11px] text-white/80">{p.cuisine}</div>
            <div className="mt-2 text-xs font-semibold">{p.promo}</div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-white/70">
              <Clock className="h-3 w-3" />
              {p.etaMin} min · {city}
            </div>
          </button>
        ))}
        <div className="flex min-w-[180px] shrink-0 flex-col justify-center rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-left">
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
