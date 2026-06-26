import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — Tibus Ride" },
      {
        name: "description",
        content:
          "Politique de confidentialité de Tibus Ride : données collectées (caméra, position, téléphone), finalités, hébergement et droits des utilisateurs.",
      },
    ],
  }),
  component: PrivacyPolicy,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-foreground">Politique de confidentialité</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dernière mise à jour : 26 juin 2026</p>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Tibus Ride (« nous ») édite les applications et le site Tibus Ride permettant de mettre en relation
          des voyageurs et des chauffeurs/livreurs partenaires en Afrique de l'Ouest. Cette politique décrit
          quelles données nous collectons, pourquoi, comment elles sont protégées, et les droits dont vous
          disposez — qu'il s'agisse de l'application <strong>Tibus Ride</strong> (voyageurs) ou de l'application{" "}
          <strong>Tibus Ride Driver</strong> (chauffeurs/livreurs).
        </p>

        <Section title="1. Données que nous collectons">
          <p>
            <strong>Compte :</strong> nom, numéro de téléphone, email (le cas échéant), mot de passe (stocké
            de façon chiffrée), pays/ville d'utilisation.
          </p>
          <p>
            <strong>Photo de profil (caméra) :</strong> lors de l'enrôlement, les chauffeurs/livreurs doivent
            prendre une photo de leur visage directement avec l'appareil photo de leur téléphone — aucun
            import depuis la galerie n'est possible. Cette photo est utilisée uniquement pour permettre au
            voyageur d'identifier visuellement son chauffeur à l'arrivée ; il s'agit d'une mesure de sécurité.
          </p>
          <p>
            <strong>Position géographique :</strong> les deux apps utilisent votre position pour proposer un
            point de départ, calculer un trajet et un tarif, et mettre en relation chauffeur/voyageur pendant
            une course. Dans l'application <strong>chauffeur</strong>, la position continue d'être transmise
            même lorsque l'application est en arrière-plan ou l'écran éteint, le temps strictement nécessaire
            pour rester localisable par le voyageur pendant une course en cours — y compris quand l'app est
            fermée au premier plan. L'application <strong>voyageur</strong> n'utilise la position qu'au
            premier plan, lorsque l'app est ouverte.
          </p>
          <p>
            <strong>Documents d'enrôlement (chauffeurs/livreurs) :</strong> permis de conduire, carte grise,
            attestation d'assurance, photos du véhicule — utilisés pour la vérification d'identité et de
            conformité avant validation du compte partenaire.
          </p>
          <p>
            <strong>Données de course :</strong> trajets, horodatages, prix, méthode de paiement choisie
            (Mobile Money, cash ou carte), évaluations.
          </p>
        </Section>

        <Section title="2. Pourquoi nous collectons ces données">
          <p>
            Mettre en relation voyageurs et chauffeurs/livreurs, calculer les tarifs, assurer la sécurité des
            utilisateurs (identification du chauffeur, vérification des documents), envoyer des notifications
            liées aux courses, et améliorer le service.
          </p>
          <p>
            Nous ne vendons aucune donnée personnelle et ne les utilisons pas à des fins publicitaires
            tierces.
          </p>
        </Section>

        <Section title="3. Hébergement et partage">
          <p>
            Les données sont hébergées chez nos sous-traitants techniques (notamment Supabase pour la base de
            données et le stockage de fichiers, Vercel pour l'hébergement web), dans le cadre strict de la
            fourniture du service. Elles peuvent être partagées avec l'autre partie d'une course (le voyageur
            voit le nom et la photo du chauffeur, et inversement le numéro de téléphone pour se contacter)
            uniquement le temps de la course.
          </p>
        </Section>

        <Section title="4. Conservation et suppression">
          <p>
            Les données sont conservées le temps de votre utilisation du service et selon nos obligations
            légales (comptabilité, lutte contre la fraude). Vous pouvez demander la suppression de votre
            compte et de vos données associées en nous contactant à l'adresse ci-dessous ; les documents
            d'enrôlement et l'historique de courses peuvent être conservés une durée limitée pour des raisons
            légales avant suppression définitive.
          </p>
        </Section>

        <Section title="5. Vos droits">
          <p>
            Vous pouvez à tout moment demander l'accès, la rectification ou la suppression de vos données
            personnelles, ou vous opposer à certains traitements, en nous contactant.
          </p>
        </Section>

        <Section title="6. Sécurité">
          <p>
            Les données sont chiffrées en transit (HTTPS/TLS). L'accès aux documents d'identité et photos est
            restreint aux équipes habilitées et aux services techniques nécessaires au fonctionnement de
            l'app.
          </p>
        </Section>

        <Section title="7. Contact">
          <p>
            Pour toute question relative à cette politique ou à vos données :{" "}
            <a href="mailto:support@tibusride.app" className="text-primary underline">
              support@tibusride.app
            </a>
            .
          </p>
        </Section>

        <Section title="8. Modifications">
          <p>
            Cette politique peut être mise à jour ; la date de dernière mise à jour figure en haut de cette
            page. En cas de changement substantiel, nous en informerons les utilisateurs via l'application.
          </p>
        </Section>
      </main>
    </div>
  );
}
