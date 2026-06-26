# Data Safety form — réponses prêtes à l'emploi (Play Console)

À remplir séparément pour **Tibus Ride** (voyageur) et **Tibus Ride Driver**
(chauffeur) dans Play Console → fiche de l'app → Politique → "Sécurité des
données". Les sections ci-dessous suivent l'ordre du questionnaire Google.

Base technique : Supabase (hébergeur/auth/DB), connexions en HTTPS (TLS) —
donc chiffrement en transit = **Oui** pour toutes les données listées.

---

## 1. Collecte et partage de données

Réponse globale (les deux apps) :
- **Cette appli collecte ou partage des types de données utilisateur ?**
  → **Oui**
- **Toutes les données sont-elles chiffrées en transit ?** → **Oui**
- **Proposez-vous un moyen de demander la suppression des données ?**
  → **Oui** (via la page `/contact` ou par email à `tabistibus@gmail.com`,
  et/ou suppression de compte si une fonctionnalité in-app existe — sinon
  préciser "sur demande par email").

---

## 2. Détail par catégorie de données

### App Voyageur — Tibus Ride

| Catégorie | Type | Collectée ? | Partagée avec des tiers ? | Finalité déclarée |
|---|---|---|---|---|
| Position | Position précise | Oui | Non | Fonctionnalité de l'app (affichage carte, calcul de course) |
| Infos personnelles | Nom | Oui | Non | Fonctionnalité de l'app, compte utilisateur |
| Infos personnelles | Adresse email | Oui | Non | Fonctionnalité de l'app, compte utilisateur |
| Infos personnelles | Numéro de téléphone | Oui | Non | Mise en contact avec le chauffeur |
| Infos financières | Infos de paiement | Selon implémentation — **si l'app ne fait que rediriger vers le prestataire Mobile Money sans stocker de données de carte/compte**, répondre **Non collectée par l'app** ; sinon **Oui**, finalité "traitement des paiements" | Oui, avec le prestataire de paiement (Mobile Money) | Traitement de la transaction |
| Identifiants app/activité | Historique des courses, interactions in-app | Oui | Non | Fonctionnement de l'app, support |
| Photos | — | Non (le voyageur n'a pas d'upload photo obligatoire dans le flux actuel — à corriger si une photo de profil voyageur existe) | — | — |

**Pratiques de sécurité** :
- Les données sont chiffrées en transit : **Oui**
- L'utilisateur peut demander la suppression de ses données : **Oui**
- Vous engagez-vous à suivre la politique "Families" de Google Play ?
  **Non** (l'app n'est pas destinée aux enfants)

### App Chauffeur — Tibus Ride Driver

| Catégorie | Type | Collectée ? | Partagée avec des tiers ? | Finalité déclarée |
|---|---|---|---|---|
| Position | Position précise **(y compris en arrière-plan)** | Oui | Non | Fonctionnalité cœur de l'app — rester localisable par le voyageur pendant une course, y compris quand l'app est en arrière-plan ou fermée au premier plan |
| Photos | Photo / caméra | Oui | Non | Photo de profil chauffeur, identification de l'utilisateur |
| Infos personnelles | Nom | Oui | Non | Compte utilisateur, identification |
| Infos personnelles | Adresse email | Oui | Non | Compte utilisateur |
| Infos personnelles | Numéro de téléphone | Oui | Non | Mise en contact avec le voyageur |
| Infos financières | Infos de paiement / gains | Oui (si l'app affiche/stocke des données de gains liées au prestataire Mobile Money) | Oui, avec le prestataire de paiement | Versement des gains, traitement des transactions |
| Identifiants app/activité | Historique des courses, statistiques | Oui | Non | Fonctionnement de l'app |

**Pratiques de sécurité** : identiques à l'app voyageur (chiffrement en
transit Oui, suppression sur demande Oui, pas destinée aux enfants).

**Formulaire dédié "Background location"** (apparaît uniquement pour l'app
chauffeur, car `ACCESS_BACKGROUND_LOCATION` est dans le manifest) — réponses :
- **Fonctionnalité cœur nécessitant la localisation en arrière-plan** :
  "Permettre au voyageur de suivre la position du chauffeur en temps réel
  pendant une course en cours, y compris lorsque l'application est en
  arrière-plan ou que l'écran est éteint, jusqu'à la fin de la course."
- **Prominent disclosure dans l'app avant la demande de permission** :
  ✅ déjà implémentée (popup avant la première activation du mode "En
  ligne" — voir `PLAYSTORE_CHECKLIST.md` §4 et commit `f994779`).
- **Vidéo de démo (~30 s)** : toujours à enregistrer/uploader (voir
  `PLAYSTORE_CHECKLIST.md` pour le script exact des actions à filmer).

---

## 3. Points à vérifier avant de soumettre

Je n'ai pas accès au code de paiement détaillé (intégration GeniusPay côté
serveur) pour confirmer si des données de carte/compte sont stockées par
l'app elle-même ou uniquement transmises au prestataire. **Vérifie ce point
avant de valider le formulaire** : si l'app ne fait que rediriger/afficher
un widget du prestataire sans jamais voir/stocker les données de paiement
brutes, la case "Infos financières" peut souvent être déclarée "non
collectée par cette app" (le prestataire déclare lui-même ses propres
pratiques). En cas de doute, déclarer "Oui, collectée" est l'option la plus
sûre côté conformité.
