import { z } from "zod";
import { MAX_DB_INT } from "./checks";

const moneyInputSchema = z.union([
  z.string().trim().min(1).max(64),
  z.number().finite().nonnegative().max(MAX_DB_INT / 100)
]);

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256)
}).strict();

export const pdfUploadFormSchema = z.object({
  pdf: z.instanceof(File)
}).strict();

export const poIdSchema = z.string().trim().min(1).max(64);

export const decisionBodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().max(2000).optional()
}).strict().superRefine((value, context) => {
  if (value.action === "REJECT" && !value.reason?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "A rejection reason is required" });
  }
});

export const poUpdateBodySchema = z.object({
  poNumber: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
  poDate: z.string().trim().min(1).max(50),
  vendorName: z.string().trim().min(1).max(250),
  documentTotal: moneyInputSchema,
  lineItems: z.array(z.object({
    sku: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().int().positive().max(MAX_DB_INT),
    unitPrice: moneyInputSchema,
    lineTotal: moneyInputSchema
  }).strict()).max(500)
}).strict();

export function normalizePoNumber(value: string) {
  return value.trim().toUpperCase();
}
