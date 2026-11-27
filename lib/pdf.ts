import pdf from "pdf-parse";
import { addPaise, calculateLineTotalPaise, parseDate, parseMoney, parseQuantity } from "./checks";

export type ExtractedLine = {
  sku: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  lineMathMatches: boolean;
};

export type ExtractedPo = {
  poNumber: string;
  poDate: string;
  vendorName: string;
  documentTotalPaise: number;
  calculatedTotalPaise: number;
  totalsMatch: boolean;
  extractionMethod: "text_layer" | "unreadable";
  lineItems: ExtractedLine[];
  warnings: string[];
};

type AmountToken = { raw: string; index: number };
type ParsedRow = Omit<ExtractedLine, "lineMathMatches">;

const SKU_AT_START = /^([A-Z]{2,}-\d+(?:-[A-Z0-9]+)*?)(?=\s|[A-Z][a-z]|$)\s*|^([A-Z0-9]+(?:-[A-Z0-9]+)+)\s+/i;
const AMOUNT = "(?:\\d{1,2}(?:,\\d{2})*,\\d{3}|\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
const TRAILING_AMOUNTS = new RegExp(`(${AMOUNT})\\s+(${AMOUNT})\\s*$`);
const CURRENCY_AMOUNT = /(?:₹|INR|Rs\.?)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
const ROW_END = /^(?:PO\s*TOTAL|GRAND\s*TOTAL|TERMS?\b|AUTHORI[ZS]ED\s+SIGNATORY|TOTAL\b)/i;

export async function extractPdf(buffer: Buffer): Promise<ExtractedPo> {
  const parsed = await pdf(buffer);
  const text = normalizePdfText(parsed.text);
  if (!isReadableText(text)) return emptyExtraction();

  const poNumber = extractPoNumber(text);
  const rawDate = extractPoDate(text);
  const poDate = rawDate ? parseDate(rawDate) ?? "" : "";
  const vendorName = extractVendor(text);
  const documentTotalPaise = extractDocumentTotal(text);
  const { lineItems, rowWarnings } = extractLineItems(text);
  const warnings = [...rowWarnings];

  if (!poNumber) warnings.push("PO number was not recognized; enter it manually.");
  if (!poDate) warnings.push("PO date was not recognized; enter it manually.");
  if (!vendorName) warnings.push("Vendor name was not recognized; enter it manually.");
  if (!documentTotalPaise) warnings.push("PO total was not recognized; enter it manually.");
  if (!lineItems.length) warnings.push("Line items were not recognized; enter them manually.");

  const calculatedTotalPaise = lineItems.reduce<number | null>(
    (sum, item) => sum === null ? null : addPaise(sum, item.lineTotalPaise),
    0
  );
  const total = calculatedTotalPaise ?? 0;
  if (calculatedTotalPaise === null) warnings.push("Line-item total exceeds the supported database range.");
  const lineMathMatches = lineItems.length > 0 && lineItems.every((item) => item.lineMathMatches);

  const hasRecognizedData = Boolean(poNumber || poDate || vendorName || documentTotalPaise || lineItems.length);
  if (!hasRecognizedData) return emptyExtraction();

  return {
    poNumber,
    poDate,
    vendorName,
    documentTotalPaise,
    calculatedTotalPaise: total,
    totalsMatch: lineMathMatches &&
      calculatedTotalPaise !== null &&
      Math.abs(total - documentTotalPaise) <= 100,
    extractionMethod: "text_layer",
    lineItems,
    warnings
  };
}

export function normalizePdfText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

export function isReadableText(text: string) {
  const printable = text.replace(/[^\x20-\x7E₹\n]/g, "");
  const alphanumeric = printable.match(/[A-Za-z0-9₹]/g)?.length ?? 0;
  const letters = printable.match(/[A-Za-z]{2,}/g)?.join("").length ?? 0;
  const ratio = alphanumeric / Math.max(printable.length, 1);
  const wordRatio = letters / Math.max(alphanumeric, 1);
  return text.trim().length >= 80 && ratio >= 0.25 && wordRatio >= 0.25;
}

export function extractPoNumber(text: string) {
  const dateLabelIndex = text.search(/P\.?\s*O\.?\s*Date\b|Order\s*Date\b/i);
  const beforeDateLabel = dateLabelIndex >= 0 ? text.slice(0, dateLabelIndex) : text;
  const labeled = beforeDateLabel.match(
    /(?:P\.?\s*O\.?\s*(?:Number|No\.?|#)|Order\s*No\.?|Purchase\s*Order\s*(?:Number|No\.?))\s*[:#-]?\s*(PO-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i
  );
  const token = labeled?.[1] ?? text.match(/\b(PO-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/i)?.[1];
  return token?.toUpperCase() ?? "";
}

export function extractPoDate(text: string) {
  const match = text.match(
    /(?:P\.?\s*O\.?\s*Date|Order\s*Date|Date)\s*[:#-]?\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i
  );
  return match?.[1] ?? "";
}

function extractVendor(text: string) {
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/(?:Vendor(?:\s+Name)?|Supplier(?:\s+Name)?)\s*[:\-]\s*(.+)$/i);
    if (match) {
      return match[1]
        .split(/\s{2,}(?=(?:Delivery|Payment|GSTIN)\b)/i)[0]
        .trim();
    }
  }
  return "";
}

function extractDocumentTotal(text: string) {
  const match = text.match(/(?:PO\s*TOTAL|GRAND\s*TOTAL)\s*[:]?\s*((?:₹|INR|Rs\.?)\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (!match) return 0;
  const raw = `${match[1] ?? ""}${match[2]}`;
  return parseMoney(raw) ?? 0;
}

function extractLineItems(text: string) {
  const lines = text.split("\n").filter(Boolean);
  const lineItems: ExtractedLine[] = [];
  const rowWarnings: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const start = lines[index];
    if (!SKU_AT_START.test(start)) {
      index++;
      continue;
    }

    let candidate = start;
    let row = parseLineRow(candidate);
    let consumed = 0;
    while (!row && index + consumed + 1 < lines.length && consumed < 3) {
      const next = lines[index + consumed + 1];
      if (SKU_AT_START.test(next) || ROW_END.test(next)) break;
      candidate += ` ${next}`;
      consumed++;
      row = parseLineRow(candidate);
    }

    if (!row) {
      const skuMatch = start.match(SKU_AT_START);
      const sku = skuMatch?.[1] ?? skuMatch?.[2] ?? "unknown SKU";
      rowWarnings.push(`Could not safely parse line item ${sku}; review it manually.`);
      index += consumed + 1;
      continue;
    }

    const expectedLineTotal = calculateLineTotalPaise(row.quantity, row.unitPricePaise);
    const lineMathMatches = expectedLineTotal !== null &&
      Math.abs(expectedLineTotal - row.lineTotalPaise) <= 100;
    if (!lineMathMatches) rowWarnings.push(`Line maths do not match for ${row.sku}.`);
    lineItems.push({ ...row, lineMathMatches });
    index += consumed + 1;

    while (index < lines.length && !SKU_AT_START.test(lines[index]) && !ROW_END.test(lines[index])) {
      const continuation = lines[index].trim();
      if (continuation && !CURRENCY_AMOUNT.test(continuation)) {
        lineItems[lineItems.length - 1].description += ` ${continuation}`;
      }
      CURRENCY_AMOUNT.lastIndex = 0;
      index++;
    }
  }

  return { lineItems, rowWarnings };
}

export function parseLineRow(text: string): ParsedRow | null {
  CURRENCY_AMOUNT.lastIndex = 0;
  const skuMatch = text.match(SKU_AT_START);
  if (!skuMatch) return null;
  const sku = (skuMatch[1] ?? skuMatch[2]).toUpperCase();
  const bodyStart = skuMatch[0].length;

  const amounts: AmountToken[] = [];
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    amounts.push({ raw: match[1], index: match.index ?? 0 });
  }

  let quantityStart: number;
  let unitRaw: string;
  let totalRaw: string;
  if (amounts.length >= 2) {
    const unit = amounts[amounts.length - 2];
    const total = amounts[amounts.length - 1];
    quantityStart = unit.index;
    unitRaw = unit.raw;
    totalRaw = total.raw;
  } else {
    const body = text.slice(bodyStart);
    const unmarked = body.match(TRAILING_AMOUNTS);
    if (!unmarked) return null;
    quantityStart = bodyStart + (unmarked.index ?? 0);
    unitRaw = unmarked[1];
    totalRaw = unmarked[2];
  }

  const beforeUnit = text.slice(bodyStart, quantityStart);
  const quantityMatch = beforeUnit.match(/(\d+)\s*$/);
  if (!quantityMatch) return null;
  const quantity = parseQuantity(Number(quantityMatch[1]));
  const unitPricePaise = parseMoney(unitRaw);
  const lineTotalPaise = parseMoney(totalRaw);
  const description = beforeUnit.slice(0, quantityMatch.index).trim().replace(/[\s,;:-]+$/, "");
  if (!quantity || unitPricePaise === null || lineTotalPaise === null || !description) return null;
  return { sku, description, quantity, unitPricePaise, lineTotalPaise };
}

function emptyExtraction(): ExtractedPo {
  return {
    poNumber: "",
    poDate: "",
    vendorName: "",
    documentTotalPaise: 0,
    calculatedTotalPaise: 0,
    totalsMatch: false,
    extractionMethod: "unreadable",
    lineItems: [],
    warnings: ["This PDF has no usable text layer. Enter PO details and line items manually."]
  };
}
