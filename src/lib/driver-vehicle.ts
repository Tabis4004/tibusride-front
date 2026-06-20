export type DriverVehiclePublic = {
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_plate?: string | null;
};

/** Marque/modèle · couleur · plaque pour affichage passager. */
export function formatDriverVehicleDescription(v: DriverVehiclePublic | null | undefined): string | null {
  if (!v) return null;
  const parts = [
    v.vehicle_model?.trim() || null,
    v.vehicle_color?.trim() || null,
    v.vehicle_plate?.trim() ? `plaque ${v.vehicle_plate.trim()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Message d'arrivée avec détails véhicule. */
export function formatDriverArrivalMessage(v: DriverVehiclePublic | null | undefined, atPickup = true): string {
  const vehicle = formatDriverVehicleDescription(v);
  if (vehicle) {
    return atPickup
      ? `${vehicle} — votre chauffeur vous attend au point de départ`
      : `${vehicle} — votre chauffeur arrive dans quelques instants`;
  }
  return atPickup
    ? "Votre chauffeur vous attend au point de départ"
    : "Votre chauffeur arrive — rejoignez le point de départ";
}
