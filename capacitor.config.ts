// Ce projet expose désormais DEUX apps Capacitor distinctes (conducteur et
// passager), chacune avec sa propre config :
//   - capacitor.driver.config.ts    -> com.tibus.ride.driver    (android-driver)
//   - capacitor.passenger.config.ts -> com.tibus.ride.passenger (android-passenger)
// Toutes les commandes `cap` doivent être lancées via les scripts npm
// `cap:*:driver` / `cap:*:passenger` (qui passent --config explicitement).
// Ce fichier racine n'est qu'un fallback par défaut (pointe vers le conducteur,
// le profil le plus critique côté natif) — ne pas l'utiliser directement.
export { default } from "./capacitor.driver.config";
