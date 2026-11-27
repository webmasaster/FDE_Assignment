export const MAX_DB_INT = 2_147_483_647;

const MONEY_PATTERN = /^(?:(?:₹|INR|Rs\.?)\s*)?((?:\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/i;

export function parseMoney(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;

  const text = String(value).trim();
  const match = text.match(MONEY_PATTERN);
  if (!match) return null;

  const rupees = Number(match[1].replace(/,/g, ""));
  const paise = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(rupees) || !Number.isSafeInteger(paise)) return null;

  const totalPaise = rupees * 100 + paise;
  return Number.isSafeInteger(totalPaise) && totalPaise <= MAX_DB_INT ? totalPaise : null;
}

export function parseQuantity(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_DB_INT) {
    return null;
  }
  return value;
}

export function addPaise(total: number, amount: number): number | null {
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(amount) ||
    total < 0 ||
    amount < 0 ||
    total > MAX_DB_INT - amount
  ) return null;
  return total + amount;
}

export function calculateLineTotalPaise(quantity: number, unitPricePaise: number): number | null {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > MAX_DB_INT ||
    !Number.isSafeInteger(unitPricePaise) ||
    unitPricePaise <= 0 ||
    unitPricePaise > MAX_DB_INT
  ) return null;
  const total = quantity * unitPricePaise;
  return Number.isSafeInteger(total) && total <= MAX_DB_INT ? total : null;
}

export function parseDate(value: string): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return validDate(+year, +month, +day)
      ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      : null;
  }

  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return validDate(+year, +month, +day)
      ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      : null;
  }

  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const [, day, monthName, year] = match;
    const month = months.indexOf(monthName.toLowerCase().slice(0, 3)) + 1;
    return month && validDate(+year, month, +day)
      ? `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`
      : null;
  }
  return null;
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatDateForDisplay(isoDate: string, timeZone = "Asia/Kolkata") {
  const parsed = parseDate(isoDate);
  if (!parsed) return isoDate;
  const [year, month, day] = parsed.split("-");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)));
}

export function rupeesPaise(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
}
