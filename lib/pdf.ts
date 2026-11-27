import pdf from "pdf-parse";
import { parseDate, parseMoney } from "./checks";

export type ExtractedLine = {
  sku: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
};

export type ExtractedPo = {
  poNumber: string;
  poDate: string;
  vendorName: string;
  documentTotalPaise: number;
  extractionMethod: "text_layer" | "unreadable";
  lineItems: ExtractedLine[];
};

export async function extractPdf(buffer: Buffer): Promise<ExtractedPo> {
  const parsed = await pdf(buffer);
  const text = parsed.text.replace(/\r/g, "");
  const printable = text.replace(/[^\x20-\x7E\r\n₹]/g, "");
  const alphanumericRatio = (printable.match(/[A-Za-z0-9₹]/g)?.length ?? 0) / Math.max(printable.length, 1);
  if (text.trim().length < 80 || alphanumericRatio < 0.25) {
    return emptyExtraction("unreadable");
  }

  const poNumberMatch =
    text.match(/(?:P[.]?O[.]?\s*(?:Number|No[.]?|#)\s*[:#]?\s*)(PO-[A-Z0-9]+(?:-[A-Z0-9]+)*)/i) ??
    text.match(/\b(PO-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?=\s|$|PO Date)/i);
  const poNumber = (poNumberMatch?.[1] ?? "").replace(/PO$/i, "");

  const poDateRaw =
    text.match(/(?:PO\s*Date|Order\s*Date)\s*[:]\s*([0-9./-]+(?:\s+[A-Za-z]+\s+[0-9]{4})?)/i)?.[1] ?? "";

  const vendorMatch =
    text.match(/Vendor\s*[:]\s*(.+)/i) ??
    text.match(/SUPPLIER\s*\n\s*\n?(.+)/i);
  const vendorName = vendorMatch?.[1]?.replace(/\s{2,}.*/, "").trim() ?? "";

  const totalMatch = text.match(/(?:PO\s*TOTAL|Grand\s*Total)\s*[:]?\s*(?:[A-Z]{3}|Rs[.]?|INR|₹)?\s*([\d,]+(?:[.]\d{1,2})?)/i);
  const documentTotalPaise = totalMatch ? parseMoney(totalMatch[1]) ?? 0 : 0;

  const lineItems: ExtractedLine[] = [];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([A-Z]{2}-\d+)(.+?)(\d{1,6})(?:₹|INR\s*|Rs[.]?\s*)?([\d,]+(?:\.\d+)?)\s*(?:₹|INR\s*|Rs[.]?\s*)?([\d,]+(?:\.\d+)?)$/i);
    if (!match) {
      if (lineItems.length && /^and\s+/i.test(line)) {
        lineItems[lineItems.length - 1].description += " " + line;
      }
      continue;
    }
    const [, sku, description, qty, unit, amount] = match;
    const quantity = Number(qty);
    const unitPricePaise = parseMoney(unit);
    const lineTotalPaise = parseMoney(amount);
    if (unitPricePaise !== null && lineTotalPaise !== null) {
      lineItems.push({ sku, description: description.trim(), quantity, unitPricePaise, lineTotalPaise });
    }
  }

  if (!poNumber && !poDateRaw && !vendorName && !documentTotalPaise) {
    return emptyExtraction("unreadable");
  }
  return {
    poNumber,
    poDate: parseDate(poDateRaw) ?? "",
    vendorName,
    documentTotalPaise,
    extractionMethod: "text_layer",
    lineItems
  };
}

function emptyExtraction(method: "unreadable"): ExtractedPo {
  return {
    poNumber: "",
    poDate: "",
    vendorName: "",
    documentTotalPaise: 0,
    extractionMethod: method,
    lineItems: []
  };
}
