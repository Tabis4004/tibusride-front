export type DeliveryPartner = {
  id: string;
  name: string;
  cuisine: string;
  promo: string;
  etaMin: number;
  badge?: string;
  gradient: string;
  cities: string[];
};

/** Annonces partenaires livraison — à brancher sur une table admin plus tard. */
export const DELIVERY_PARTNERS: DeliveryPartner[] = [
  {
    id: "maquis-plateau",
    name: "Maquis du Plateau",
    cuisine: "Grillades & attiéké",
    promo: "-15 % livraison Tibus",
    etaMin: 25,
    badge: "Partenaire",
    gradient: "from-orange-500 to-rose-600",
    cities: ["Abidjan", "Dakar"],
  },
  {
    id: "chez-aminata",
    name: "Chez Aminata",
    cuisine: "Plats ivoiriens",
    promo: "Livraison offerte dès 8 000 F",
    etaMin: 20,
    gradient: "from-emerald-500 to-teal-600",
    cities: ["Abidjan"],
  },
  {
    id: "le-patio",
    name: "Le Patio",
    cuisine: "Burger & tacos",
    promo: "Menu midi à 4 500 F",
    etaMin: 18,
    badge: "Nouveau",
    gradient: "from-violet-500 to-indigo-600",
    cities: ["Abidjan", "Dakar", "Lomé"],
  },
  {
    id: "saveurs-dakar",
    name: "Saveurs Dakar",
    cuisine: "Thiéboudienne & yassa",
    promo: "Partenaire Tibus Delivery",
    etaMin: 30,
    gradient: "from-amber-500 to-orange-600",
    cities: ["Dakar"],
  },
  {
    id: "coco-food",
    name: "Coco Food",
    cuisine: "Healthy bowls",
    promo: "-10 % avec code TIBUS",
    etaMin: 22,
    gradient: "from-pink-500 to-fuchsia-600",
    cities: ["Abidjan", "Accra"],
  },
];

export function getDeliveryPartnersForCity(city: string): DeliveryPartner[] {
  return DELIVERY_PARTNERS.filter((p) => p.cities.includes(city));
}
