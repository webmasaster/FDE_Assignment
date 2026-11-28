export type ReviewedLineWarningState = {
  sku: string;
  complete: boolean;
  lineMathMatches: boolean;
};

/** Returns null for warnings that are not tied to one extracted line item. */
export function shouldShowLineExtractionWarning(
  warning: string,
  lines: ReviewedLineWarningState[]
): boolean | null {
  const mathWarning = warning.match(/^Line maths do not match for (.+)\.$/i);
  const parseWarning = warning.match(/^Could not safely parse line item (.+);/i);
  const match = mathWarning ?? parseWarning;
  if (!match) return null;

  const sku = match[1].trim().toUpperCase();
  const affectedLines = lines.filter((line) => line.sku.trim().toUpperCase() === sku);
  if (mathWarning) return affectedLines.some((line) => !line.lineMathMatches);
  return affectedLines.some((line) => !line.complete);
}
