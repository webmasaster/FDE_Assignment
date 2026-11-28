import pdf from "pdf-parse";
import { parseDate, parseMoney } from "./checks";

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

type AmountToken = {
  raw: string;
  index: number;
  negative: boolean;
};

type ParsedRow = Omit<ExtractedLine, "lineMathMatches">;

/**
 * Matches common SKU formats such as MC-001, HY-203 and MC-027-ABC.
 * The trailing asterisk is accepted for PDFs that mark a SKU with a footnote.
 */
const SKU_AT_START = /^(?:\d+\s+)?([A-Z0-9]+(?:-[A-Z0-9]+)+)\*?(?:\s+|$)/i;

/**
 * Supports both Indian and international thousands grouping:
 * 1,20,000 | 12,34,567 | 1,234,567 | 60000 | 120.50
 * Up to two decimal places are accepted because amounts are stored in paise.
 */
const NUMBER_PATTERN =
  String.raw`(?:\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;

const NUMBER_TOKEN_REGEX = new RegExp(
  String.raw`(?:₹\s*|INR\s*|Rs\.?\s*)?(?<![\d,.])(${NUMBER_PATTERN})(?![\d,.])`,
  "gi"
);

const DATE_PATTERN =
  String.raw`(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})`;

const PO_NUMBER_PATTERN = String.raw`(PO-[A-Z0-9]+(?:-[A-Z0-9]+)*)`;
const LABELED_PO_ID_PATTERN = String.raw`([A-Z0-9]+(?:-[A-Z0-9]+)+)`;

const ROW_END =
  /^(?:PO\s*TOTAL|GRAND\s*TOTAL|SUB\s*TOTAL|TERMS?\b|AUTHORI[ZS]ED\s+SIGNATORY|SIGNATURE\b|NOTES?\b)/i;

const STRUCTURAL_LINE =
  /^(?:PEP\s+BRANDS?|PURCHASE\s+ORDER|SKU\s+DESCRIPTION|SKU\b|DESCRIPTION\b|QTY\b|QUANTITY\b|UNIT\s+PRICE\b|AMOUNT\b|PO\s*DATE\b|ORDER\s*DATE\b|P\.?\s*O\.?\s*(?:NUMBER|NO\.?|#)\b|VENDOR\b|SUPPLIER\b|DELIVERY\b|PAYMENT\b|GSTIN\b|PO\s*TOTAL\b|GRAND\s*TOTAL\b|SUB\s*TOTAL\b|TERMS?\b|AUTHORI[ZS]ED\b)/i;

export async function extractPdf(buffer: Buffer): Promise<ExtractedPo> {
  let extractedText = "";

  try {
    const parsed = await pdf(buffer);
    extractedText = typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return emptyExtraction(
      "The PDF could not be read. It may be encrypted, malformed, or unsupported. Enter the PO details manually."
    );
  }

  const text = normalizePdfText(extractedText);

  if (!isReadableText(text)) {
    return emptyExtraction(
      "This PDF has no usable text layer. It may be a scan or contain garbled text. Enter the PO details and line items manually."
    );
  }

  const poNumber = extractPoNumber(text);
  const rawDate = extractPoDate(text);
  const poDate = rawDate ? parseDate(rawDate) ?? "" : "";
  const vendorName = extractVendor(text);
  const documentTotalPaise = extractDocumentTotal(text);
  const { lineItems, rowWarnings } = extractLineItems(text);
  const warnings = [...rowWarnings];

  if (!poNumber) {
    warnings.push("PO number was not recognized; enter it manually.");
  }

  if (!poDate) {
    warnings.push("PO date was not recognized; enter it manually.");
  }

  if (!vendorName) {
    warnings.push("Vendor name was not recognized; enter it manually.");
  }

  if (documentTotalPaise <= 0) {
    warnings.push("PO total was not recognized; enter it manually.");
  }

  if (lineItems.length === 0) {
    warnings.push("Line items were not recognized; enter them manually.");
  }

  const calculatedTotalPaise = sumLineTotals(lineItems);
  const lineMathMatches =
    lineItems.length > 0 && lineItems.every((item) => item.lineMathMatches);

  if (lineItems.length > 0 && !lineMathMatches) {
    warnings.push("One or more line-item calculations do not match the printed amounts.");
  }

  const totalsMatch =
    documentTotalPaise > 0 &&
    calculatedTotalPaise !== null &&
    lineMathMatches &&
    Math.abs(calculatedTotalPaise - documentTotalPaise) <= 100;

  if (lineItems.length > 0 && documentTotalPaise > 0 && !totalsMatch) {
    warnings.push("The calculated line-item total does not match the printed PO total.");
  }

  if (calculatedTotalPaise === null) {
    warnings.push("The sum of line-item amounts exceeds the supported safe integer range.");
  }

  const hasRecognizedData = Boolean(
    poNumber || poDate || vendorName || documentTotalPaise > 0 || lineItems.length > 0
  );

  if (!hasRecognizedData) {
    return emptyExtraction(
      "No reliable PO fields could be recognized. Enter the PO details manually."
    );
  }

  return {
    poNumber,
    poDate,
    vendorName,
    documentTotalPaise,
    calculatedTotalPaise: calculatedTotalPaise ?? 0,
    totalsMatch,
    extractionMethod: "text_layer",
    lineItems,
    warnings
  };
}

/**
 * Normalize line endings and unusual spaces without merging separate PDF rows.
 * Repeated horizontal spaces are collapsed because extraction relies on tokens,
 * not visual column alignment.
 */
export function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

/**
 * A text layer is not considered usable merely because it contains many
 * printable characters. Garbled PDFs can contain printable-looking symbols.
 * This check also requires a reasonable number of alphabetic words.
 */
export function isReadableText(text: string): boolean {
  const printable = text.replace(/[^\x20-\x7E₹\n]/g, "");
  const alphanumericCount = printable.match(/[A-Za-z0-9₹]/g)?.length ?? 0;
  const words = printable.match(/[A-Za-z]{2,}/g) ?? [];
  const letterCount = words.join("").length;
  const printableRatio = alphanumericCount / Math.max(printable.length, 1);

  return (
    text.trim().length >= 80 &&
    printableRatio >= 0.25 &&
    words.length >= 8 &&
    letterCount >= 30
  );
}

/** Extracts PO number from labelled formats or a standalone PO-... token. */
export function extractPoNumber(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  const labelledPattern = new RegExp(
    String.raw`(?:P\.?\s*O\.?\s*(?:Number|No\.?|#)|Purchase\s*Order\s*(?:Number|No\.?|#)|Order\s*(?:Number|No\.?|#))\s*[:#-]?\s*${LABELED_PO_ID_PATTERN}`,
    "i"
  );

  const labelledMatch = normalized.match(labelledPattern);
  const fallbackMatch = normalized.match(new RegExp(`\\b${PO_NUMBER_PATTERN}\\b`, "i"));
  const poNumber = labelledMatch?.[1] ?? fallbackMatch?.[1] ?? "";

  return poNumber.toUpperCase();
}

/** Extracts a date next to PO Date, Order Date, or Date labels. */
export function extractPoDate(text: string): string {
  const pattern = new RegExp(
    String.raw`(?:P\.?\s*O\.?\s*Date|Order\s*Date|Date)\s*[:#-]?\s*(${DATE_PATTERN})`,
    "i"
  );

  return text.match(pattern)?.[1] ?? "";
}

/**
 * Supports both "Vendor: ABC Industries" and layouts where the vendor label
 * and vendor value appear on separate lines, including a separate leading ':' .
 */
export function extractVendor(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const vendorLabel = /^(?:Vendor(?:\s+Name)?|Supplier(?:\s+Name)?)\s*:?[ \t]*(.*)$/i;

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(vendorLabel);
    if (!match) continue;

    let value = match[1].trim().replace(/^:\s*/, "");

    // Some PDF text extractors read the left and right columns separately.
    // In those files, "Vendor" can be followed by PO Date / Delivery labels,
    // while the actual value appears a few lines later as ": ABC Industries".
    if (!value) {
      for (let next = index + 1; next < Math.min(index + 10, lines.length); next++) {
        const candidate = lines[next].trim();

        if (isSkuLine(candidate)) {
          break;
        }

        if (/^:\s*\S/.test(candidate)) {
          value = candidate.replace(/^:\s*/, "").trim();
          break;
        }

        // Skip other header labels that may be interleaved by PDF reading order.
        if (
          STRUCTURAL_LINE.test(candidate) ||
          /^(?:PO\s*DATE|ORDER\s*DATE|DATE|DELIVERY|PAYMENT)\s*:/i.test(candidate)
        ) {
          continue;
        }

        // The value may be a standalone line after the metadata labels.
        if (/^[A-Za-z][A-Za-z0-9 &().,'/-]{1,80}$/.test(candidate)) {
          value = candidate;
          break;
        }
      }
    }

    if (!value) continue;

    // In side-by-side layouts, Delivery or Payment can follow the vendor name.
    value = value
      .split(/\s+(?=(?:Delivery|Payment|GSTIN)\s*:)/i)[0]
      .replace(/^[:\s]+|[:\s]+$/g, "")
      .trim();

    if (value && !STRUCTURAL_LINE.test(value)) {
      return value;
    }
  }

  return "";
}

/** Extracts PO TOTAL or GRAND TOTAL, including values placed on the next line. */
export function extractDocumentTotal(text: string): number {
  const totalLabel = /(?:PO\s*TOTAL|GRAND\s*TOTAL)\b/i;
  const labelMatch = totalLabel.exec(text);
  if (!labelMatch || labelMatch.index === undefined) return 0;

  const afterLabel = text.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 500);

  // Prefer a currency-marked amount. It avoids accidentally interpreting a
  // year or a PO number in a footer as the document total.
  const currencyPattern = new RegExp(
    String.raw`(?:₹\s*|INR\s*|Rs\.?\s*)(?<![\d,.])(${NUMBER_PATTERN})(?![\d,.])`,
    "i"
  );
  const currencyMatches = [...afterLabel.matchAll(new RegExp(currencyPattern.source, "gi"))];
  const lastCurrencyMatch = currencyMatches[currencyMatches.length - 1];
  if (lastCurrencyMatch?.[1]) {
    return parsePositiveMoney(lastCurrencyMatch[1]) ?? 0;
  }

  // Fallback for templates that print an unmarked amount. Skip common footer
  // labels before accepting the first numeric token after the total label.
  const lines = afterLabel.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^(?:TERMS?\b|AUTHORI[ZS]ED\b|SIGNATURE\b|NOTES?\b)/i.test(line)) {
      continue;
    }
    if (/^(?:PO\s*(?:NUMBER|NO\.?|#)|ORDER\s*(?:NUMBER|NO\.?))\b/i.test(line)) {
      continue;
    }

    const tokens = findAmountTokens(line);
    if (tokens.length > 0) {
      return parsePositiveMoney(tokens[0].raw) ?? 0;
    }
  }

  return 0;
}

function extractLineItems(text: string): {
  lineItems: ExtractedLine[];
  rowWarnings: string[];
} {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const lineItems: ExtractedLine[] = [];
  const rowWarnings: string[] = [];

  let index = 0;

  while (index < lines.length) {
    const startLine = lines[index];
    const skuMatch = startLine.match(SKU_AT_START);
    if (skuMatch && !isLikelySku(skuMatch[1])) {
      index++;
      continue;
    }

    if (!skuMatch) {
      index++;
      continue;
    }

    let candidate = startLine;
    let bestParsedRow = parseLineRow(candidate);
    let bestConsumed = 0;
    let consumed = 0;
    let foundMathMatch = bestParsedRow ? doesLineMathMatch(bestParsedRow) : false;

    // pdf-parse can split one visual row into several text lines. A partial
    // candidate may temporarily look like three numeric columns because a
    // description contains digits (for example, "200ml"). Keep accumulating
    // until line maths match, or until the next row / section begins.
    while (
      !foundMathMatch &&
      index + consumed + 1 < lines.length &&
      consumed < 8
    ) {
      const nextLine = lines[index + consumed + 1];

      if (
        isSkuLine(nextLine) ||
        ROW_END.test(nextLine) ||
        STRUCTURAL_LINE.test(nextLine)
      ) {
        break;
      }

      candidate += ` ${nextLine}`;
      consumed++;

      const candidateRow = parseLineRow(candidate);
      if (candidateRow) {
        bestParsedRow = candidateRow;
        bestConsumed = consumed;
        foundMathMatch = doesLineMathMatch(candidateRow);
      }
    }

    const parsedRow = bestParsedRow;

    if (!parsedRow) {
      const sku = skuMatch[1].toUpperCase();
      rowWarnings.push(
        `Could not safely parse line item ${sku}; review its quantity, unit price and line total manually.`
      );
      index += consumed + 1;
      continue;
    }

    // Consume only the lines used by the best parse. Any trailing descriptive
    // continuation is handled by the loop below.
    consumed = bestConsumed;
    const expectedLineTotal = calculateLineTotalPaise(
      parsedRow.quantity,
      parsedRow.unitPricePaise
    );

    const lineMathMatches =
      expectedLineTotal !== null &&
      Math.abs(expectedLineTotal - parsedRow.lineTotalPaise) <= 100;

    if (!lineMathMatches) {
      rowWarnings.push(`Line maths do not match for ${parsedRow.sku}.`);
    }

    const extractedLine: ExtractedLine = {
      ...parsedRow,
      lineMathMatches
    };

    lineItems.push(extractedLine);
    index += consumed + 1;

    // Some PDFs place a wrapped description after the numeric columns of a
    // row (for example, "and Walnut Shell 250g"). Preserve such text, but do
    // not append headers, totals, currency values, or the next SKU row.
    while (
      index < lines.length &&
      !isSkuLine(lines[index]) &&
      !ROW_END.test(lines[index])
    ) {
      const continuation = lines[index].trim();

      if (isDescriptionContinuation(continuation)) {
        extractedLine.description = `${extractedLine.description} ${continuation}`.trim();
      }

      index++;
    }
  }

  return { lineItems, rowWarnings };
}

/**
 * Parses a row whose SKU is at the beginning and whose final three numeric
 * values are quantity, unit price and line total. Numeric tokens inside the
 * description (such as 200ml or SPF50) are preserved because the parser uses
 * the final three numeric tokens as the columns.
 */
export function parseLineRow(text: string): ParsedRow | null {
  const skuMatch = text.match(SKU_AT_START);
  if (!skuMatch || !isLikelySku(skuMatch[1])) return null;

  const sku = skuMatch[1].toUpperCase();
  const bodyStart = skuMatch[0].length;
  const body = text.slice(bodyStart);
  const amountTokens = findAmountTokens(body);

  if (amountTokens.length < 3) return null;

  const quantityToken = amountTokens[amountTokens.length - 3];
  const unitPriceToken = amountTokens[amountTokens.length - 2];
  const lineTotalToken = amountTokens[amountTokens.length - 1];

  if (quantityToken.negative || unitPriceToken.negative || lineTotalToken.negative) {
    return null;
  }

  const quantity = parsePositiveQuantity(quantityToken.raw);
  const unitPricePaise = parsePositiveMoney(unitPriceToken.raw);
  const lineTotalPaise = parsePositiveMoney(lineTotalToken.raw);

  const description = body
    .slice(0, quantityToken.index)
    .replace(/[\s,;:-]+$/g, "")
    .trim();

  if (
    quantity === null ||
    unitPricePaise === null ||
    lineTotalPaise === null ||
    !description
  ) {
    return null;
  }

  return {
    sku,
    description,
    quantity,
    unitPricePaise,
    lineTotalPaise
  };
}

function findAmountTokens(text: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  const regex = new RegExp(NUMBER_TOKEN_REGEX.source, "gi");

  for (const match of text.matchAll(regex)) {
    const raw = match[1];
    if (!raw) continue;

    const fullMatch = match[0];
    const relativeIndex = (match.index ?? 0) + fullMatch.lastIndexOf(raw);

    const negative = /[-−]\s*$/.test(text.slice(0, relativeIndex));
    tokens.push({ raw, index: relativeIndex, negative });
  }

  return tokens;
}

function firstAmountToken(text: string): number | null {
  const tokens = findAmountTokens(text);
  if (tokens.length === 0) return null;
  return parsePositiveMoney(tokens[0].raw);
}

function parsePositiveQuantity(raw: string): number | null {
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parsePositiveMoney(raw: string): number | null {
  const value = parseMoney(raw);
  if (value === null || !Number.isSafeInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function doesLineMathMatch(row: ParsedRow): boolean {
  const expected = calculateLineTotalPaise(row.quantity, row.unitPricePaise);
  return expected !== null && Math.abs(expected - row.lineTotalPaise) <= 100;
}

function calculateLineTotalPaise(
  quantity: number,
  unitPricePaise: number
): number | null {
  const total = quantity * unitPricePaise;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function sumLineTotals(items: ExtractedLine[]): number | null {
  let total = 0;

  for (const item of items) {
    const next = total + item.lineTotalPaise;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }

  return total;
}

function isLikelySku(value: string): boolean {
  const sku = value.toUpperCase();
  // These are document/test reference IDs, not product SKUs.
  return !sku.startsWith("PO-") && !sku.startsWith("FDE-TST-");
}

function isSkuLine(line: string): boolean {
  const match = line.match(SKU_AT_START);
  return Boolean(match && isLikelySku(match[1]));
}

function isDescriptionContinuation(line: string): boolean {
  if (!line || STRUCTURAL_LINE.test(line) || ROW_END.test(line)) return false;
  if (SKU_AT_START.test(line)) return false;
  if (/(?:₹|\bINR\b|\bRs\.?\s*\d)/i.test(line)) return false;
  return true;
}

function emptyExtraction(message: string): ExtractedPo {
  return {
    poNumber: "",
    poDate: "",
    vendorName: "",
    documentTotalPaise: 0,
    calculatedTotalPaise: 0,
    totalsMatch: false,
    extractionMethod: "unreadable",
    lineItems: [],
    warnings: [message]
  };
}
