import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CITIES } from "@/lib/pricing";
import { ArrowRight, Banknote, MapPin, ShieldCheck, Smartphone, Star, Wifi } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tibus Ride — VTC Taxi, Éco, Confort VTC moto, tricycle & voiture VIP en Afrique de l'Ouest" },
      { name: "description", content: "Commandez une course en quelques secondes à Dakar, Abidjan, Lomé, Cotonou, Niamey, Bamako, Ouagadougou, Accra, Lagos, Abuja et Conakry. Paiement Mobile Money, cash ou carte." },
      { property: "og:title", content: "Tibus Ride — VTC en Afrique de l'Ouest" },
      { property: "og:description", content: "Taxi (1-4 pass.), Éco, Confort, Confort+, VIP. 11 villes en Afrique de l'Ouest. Paiement Mobile Money, cash ou carte." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/"><Logo /></Link>
          <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
            <a href="#services" className="hover:text-foreground">Services</a>
            <a href="#villes" className="hover:text-foreground">Villes</a>
            <a href="#chauffeurs" className="hover:text-foreground">Devenir chauffeur</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost" size="sm">Se connecter</Button></Link>
            <Link to="/auth" search={{ mode: "signup" } as never}>
              <Button size="sm">Commander</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="bg-sunset">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col justify-center">
            <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-card/70 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              Disponible dans 7 villes d'Afrique francophone
            </span>
            <h1 className="font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
              Votre course, <span className="text-primary">à votre rythme.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Taxi, Éco, Confort, Confort+ ou VIP — commandez en quelques secondes,
              payez en Mobile Money, cash ou par carte. Tibus Ride connecte
              passagers et chauffeurs partout en Afrique de l'Ouest.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth" search={{ mode: "signup" } as never}>
                <Button size="lg" className="gap-2">
                  Commander une course <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#chauffeurs">
                <Button size="lg" variant="outline">Devenir chauffeur</Button>
              </a>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5"><Star className="h-4 w-4 fill-warning text-warning" />4.8 / 5</div>
              <div>+50 000 courses</div>
              <div>+2 500 chauffeurs</div>
            </div>
          </div>

          {/* Carte estimation */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-primary/10 blur-3xl" />
            <div className="relative rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-glow)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">Estimer ma course</h3>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">Dakar</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <div className="h-2.5 w-2.5 rounded-full bg-success" />
                  <div className="flex-1 text-sm">Plateau, près du marché Sandaga</div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                  <div className="flex-1 text-sm">Aéroport AIBD, Diass</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(Object.entries(CATEGORIES) as Array<[keyof typeof CATEGORIES, typeof CATEGORIES[keyof typeof CATEGORIES]]>).slice(0, 4).map(([key, c]) => (
                  <div key={key} className="rounded-xl border border-border bg-background p-3">
                    <div className="text-2xl">{c.emoji}</div>
                    <div className="mt-1 text-sm font-semibold">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.eta}</div>
                  </div>
                ))}
              </div>
              <Link to="/auth" search={{ mode: "signup" } as never} className="mt-4 block">
                <Button className="w-full">Commander maintenant</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Pensé pour nos villes</h2>
          <p className="mt-3 text-muted-foreground">
            Cinq catégories de véhicules pour s'adapter à votre trajet, votre budget
            et l'état du trafic.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.entries(CATEGORIES) as Array<[string, typeof CATEGORIES[keyof typeof CATEGORIES]]>).map(([key, c]) => (
            <div key={key} className="group rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-soft)]">
              <div className="text-4xl">{c.emoji}</div>
              <h3 className="mt-4 font-display text-xl font-semibold">{c.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{c.capacity}</p>
              <p className="mt-2 text-xs text-muted-foreground">{c.description}</p>
              <div className="mt-4 text-xs text-muted-foreground">
                <div>À partir de <span className="font-semibold text-foreground">{c.base.toLocaleString("fr-FR")} FCFA</span></div>
                <div>Délai : {c.eta}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* AVANTAGES */}
      <section className="bg-secondary/50 pattern-mud">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-20 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            { icon: Smartphone, title: "Mobile Money", text: "Orange Money, Wave, MTN MoMo, Moov Money — payez comme vous voulez." },
            { icon: Banknote, title: "Cash & carte", text: "Réglez en espèces au chauffeur ou par carte Visa/Mastercard." },
            { icon: Wifi, title: "Mode léger", text: "L'app fonctionne en 2G/3G. Réservation possible par téléphone." },
            { icon: ShieldCheck, title: "Chauffeurs vérifiés", text: "Pièces et permis contrôlés avant chaque mise en ligne." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* VILLES */}
      <section id="villes" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Présent dans 7 villes</h2>
          <p className="mt-3 text-muted-foreground">D'autres arrivent prochainement.</p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CITIES.map((c) => (
            <div key={c.value} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
              <MapPin className="h-5 w-5 text-primary" />
              <div>
                <div className="font-semibold">{c.value}</div>
                <div className="text-xs text-muted-foreground">{c.country}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CHAUFFEURS */}
      <section id="chauffeurs" className="bg-night-gradient text-secondary">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold sm:text-4xl text-secondary">
              Conduisez avec Tibus Ride
            </h2>
            <p className="mt-4 max-w-md text-secondary/80">
              Avec votre véhicule, transformez
              votre véhicule en revenu. Inscription gratuite, paiement
              hebdomadaire, support 7j/7.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-secondary/80">
              <li>• Aucun abonnement, commission claire</li>
              <li>• Paiements directs en Mobile Money</li>
              <li>• Tableau de bord en temps réel</li>
            </ul>
            <Link to="/auth" search={{ mode: "driver" } as never} className="mt-8 inline-block">
              <Button size="lg" variant="secondary">Postuler comme chauffeur</Button>
            </Link>
          </div>
          <div className="rounded-3xl border border-secondary/20 bg-card/10 p-8 backdrop-blur">
            <div className="grid grid-cols-2 gap-6 text-secondary">
              <div>
                <div className="font-display text-4xl font-bold">+150K</div>
                <div className="text-sm text-secondary/70">FCFA / semaine en moyenne</div>
              </div>
              <div>
                <div className="font-display text-4xl font-bold">24/7</div>
                <div className="text-sm text-secondary/70">Support chauffeur</div>
              </div>
              <div>
                <div className="font-display text-4xl font-bold">3 jours</div>
                <div className="text-sm text-secondary/70">Validation moyenne</div>
              </div>
              <div>
                <div className="font-display text-4xl font-bold">15%</div>
                <div className="text-sm text-secondary/70">Commission unique</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Logo />
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Tibus Ride — Fait en Afrique de l'Ouest 🌍</p>
        </div>
      </footer>
    </div>
  );
}
