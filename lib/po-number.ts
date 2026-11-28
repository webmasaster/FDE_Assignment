/** Internal identifiers used while a creator supplies a missing PO number. */
export function isTemporaryPoNumber(value: string) {
  return /^DRAFT-(?:[0-9A-F]{8}|SAMPLE-[A-Z0-9-]+)$/i.test(value);
}
