# Fiches store Play Console — textes prêts à copier-coller

Basé uniquement sur les données vérifiables du code (`src/lib/pricing.ts`,
`src/lib/delivery-pricing.ts`) : **11 villes / 9 pays**, catégories de course
réelles (Taxi, Éco, Confort, Confort+, VIP), catégories de livraison réelles
(deux-roues, moto, tricycle, voiture, fourgon), paiement Mobile Money / cash /
carte.

⚠️ Je n'ai **pas repris** les statistiques de la page d'accueil
("+50 000 courses", "+2 500 chauffeurs", "4.8/5") ni le badge "7 villes" :
ce sont des chiffres marketing non vérifiables/incohérents avec le code
(qui liste 11 villes), et Google Play interdit les allégations invérifiables
dans une fiche store. Si ces chiffres sont réels, dis-le-moi et je les
intégrerai ; sinon mieux vaut les corriger aussi sur la landing page.

---

## App Voyageur — "Tibus Ride" (`com.tibus.ride.passenger`)

### Titre (30 car. max)
```
Tibus Ride
```

### Description courte (80 car. max)
```
VTC en Afrique de l'Ouest : Taxi, Éco, Confort, VIP, livraison, Mobile Money
```
(76 caractères)

### Description longue (4000 car. max)
```
Tibus Ride est votre application de VTC (transport avec chauffeur) et de
livraison en Afrique de l'Ouest. Commandez une course en quelques secondes
à Dakar, Abidjan, Lomé, Cotonou, Niamey, Bamako, Ouagadougou, Accra, Lagos,
Abuja ou Conakry.

COURSES POUR TOUS LES BUDGETS
• Taxi — course partagée ou privée, jusqu'à 4 passagers
• Éco — économique, idéal pour les trajets en solo
• Confort — véhicule récent, plus d'espace
• Confort+ — haut de gamme, chauffeur expérimenté
• VIP — berline premium avec service personnalisé

LIVRAISON DE COLIS
Envoyez documents, petits colis, repas ou colis fragiles avec le véhicule
adapté : deux-roues, moto, tricycle, voiture ou fourgon, selon le volume et
l'urgence.

PAIEMENT SIMPLE ET FLEXIBLE
Payez par Mobile Money, en espèces ou par carte — au choix, selon ce qui
vous convient le mieux.

POURQUOI TIBUS RIDE ?
• Suivi en temps réel de votre chauffeur sur la carte
• Estimation du prix avant de commander, sans surprise
• Choix de chauffeurs vérifiés
• Disponible dans 9 pays d'Afrique de l'Ouest : Sénégal, Côte d'Ivoire,
  Togo, Bénin, Niger, Mali, Burkina Faso, Ghana, Nigeria et Guinée

Une question, besoin d'aide ou demande relative à vos données ? Contactez-
nous depuis l'application ou via la page Contact de notre site.
```

---

## App Chauffeur — "Tibus Ride Driver" (`com.tibus.ride.driver`)

### Titre (30 car. max)
```
Tibus Ride Driver
```

### Description courte (80 car. max)
```
App chauffeur Tibus Ride : recevez des courses et livraisons, gérez vos gains
```
(78 caractères)

### Description longue (4000 car. max)
```
Tibus Ride Driver est l'application dédiée aux chauffeurs et livreurs
partenaires de Tibus Ride en Afrique de l'Ouest : Sénégal, Côte d'Ivoire,
Togo, Bénin, Niger, Mali, Burkina Faso, Ghana, Nigeria et Guinée.

RECEVEZ DES COURSES ET LIVRAISONS
Passez en ligne et recevez des demandes de course (Taxi, Éco, Confort,
Confort+, VIP) ou de livraison (deux-roues, moto, tricycle, voiture,
fourgon) à proximité, avec estimation de gain avant acceptation.

RESTEZ LOCALISABLE PENDANT VOS COURSES
Une fois en ligne, votre position est partagée avec le voyageur pour qu'il
puisse vous suivre et vous retrouver facilement, y compris lorsque
l'application est en arrière-plan, afin de garantir un suivi continu
jusqu'à la fin de la course. Vous contrôlez ce partage : repassez « hors
ligne » à tout moment pour l'arrêter.

GÉREZ VOS GAINS
Suivez vos courses, vos revenus et vos statistiques directement depuis
l'application. Encaissement par Mobile Money, espèces ou carte selon le
mode de paiement choisi par le client.

PROFIL VÉRIFIÉ
Complétez votre profil chauffeur (photo, documents) pour être identifié et
inspirer confiance aux voyageurs.

Une question ou besoin d'aide ? Contactez-nous depuis l'application ou via
la page Contact de notre site.
```

---

## Notes pour le copier-coller en Play Console

- Catégorie suggérée : **Cartes et navigation** ou **Voyage** (selon
  disponibilité par marché ; à choisir dans la liste proposée par la Play
  Console au moment de la création de la fiche).
- Email de contact : `tabistibus@gmail.com`
- Site web : `https://tibusride-front.vercel.app`
- Politique de confidentialité : `https://tibusride-front.vercel.app/confidentialite`
- Page de contact (si demandée séparément) : `https://tibusride-front.vercel.app/contact`
- Captures d'écran et icône/feature graphic : toujours en attente (voir
  `PLAYSTORE_CHECKLIST.md` §3) — je n'ai pas de visuels à générer ici, ce
  sont des exports graphiques à préparer séparément.
