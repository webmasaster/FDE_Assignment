export function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "").replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export function parseDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  if (iso.test(text)) {
    const [, y, m, d] = text.match(iso)!;
    return validDate(+y, +m, +d) ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
  }
  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return validDate(+y, +m, +d) ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
  }
  match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (match) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const [, d, monthName, y] = match;
    const m = months.indexOf(monthName.toLowerCase().slice(0, 3)) + 1;
    return m && validDate(+y, m, +d) ? `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}` : null;
  }
  return null;
}

function validDate(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function rupeesPaise(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
}
