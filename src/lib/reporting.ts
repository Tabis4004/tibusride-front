/** Agrégation par période (jour/semaine/mois) pour les graphiques de
 * "Suivi financier KPI" — partagée entre l'onglet admin (toutes courses) et
 * le rapport personnel chauffeur (ses propres courses), pour éviter la
 * duplication de logique entre les deux écrans. */
export type ReportGranularity = "day" | "week" | "month";

export function periodBucketKey(iso: string, granularity: ReportGranularity) {
  const d = new Date(iso);
  if (granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    // Lundi de la semaine ISO
    const day = new Date(d);
    const dow = (day.getDay() + 6) % 7; // 0 = lundi
    day.setDate(day.getDate() - dow);
    return day.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export function buildPeriodSeries(rows: any[], granularity: ReportGranularity) {
  const buckets = new Map<string, { period: string; ca_xof: number; commission_xof: number; bonus_xof: number; courses: number }>();
  for (const r of rows) {
    if (!r.completed_at) continue;
    const key = periodBucketKey(r.completed_at, granularity);
    const b = buckets.get(key) ?? { period: key, ca_xof: 0, commission_xof: 0, bonus_xof: 0, courses: 0 };
    b.ca_xof += r.price_xof ?? 0;
    b.commission_xof += r.commission_xof ?? 0;
    b.bonus_xof += r.bonus_xof ?? 0;
    b.courses += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.values()).sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** CSV minimal (sans dépendance) — même implémentation que celle utilisée
 * dans l'onglet admin, pour l'export "Détail (CSV)" du rapport chauffeur. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(";"), ...rows.map((r) => headers.map((h) => escape(r[h])).join(";"))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
