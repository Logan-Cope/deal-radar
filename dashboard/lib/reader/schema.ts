/**
 * What one reading of one note returns, before lib/reader/check.ts drops what
 * code cannot verify. Built for structured outputs: every field required,
 * "nothing" is an empty string or array, objects closed, no numeric bounds.
 * Item ids are plain strings, never a per-request enum, so the compiled
 * grammar stays cached; code checks them against the candidates.
 */
import { z } from "zod";
import { MARKETPLACES } from "@/lib/ledger/types";

/** The fields a note can change. Never brand, name, store, bought date or retail. */
export const READER_FIELDS = [
  "arrived_on",
  "posted_on",
  "posted_where",
  "posted_price",
  "sold_on",
  "sold_price",
  "payout",
  "size",
  "paid",
] as const;
export type ReaderField = (typeof READER_FIELDS)[number];

export const MONEY_FIELDS: readonly ReaderField[] = ["posted_price", "sold_price", "payout", "paid"];
export const DATE_FIELDS: readonly ReaderField[] = ["arrived_on", "posted_on", "sold_on"];

export const readerChangeSchema = z.strictObject({
  item_ref: z.string().describe("Candidate id this change applies to"),
  field: z.enum(READER_FIELDS),
  value: z
    .string()
    .describe(`Dates YYYY-MM-DD. Money in dollars, like 425.00. posted_where is one of ${MARKETPLACES.join(", ")}. size as written.`),
  evidence: z.string().describe("A verbatim quote from the note that shows the value"),
  confidence: z.enum(["high", "medium", "low"]),
});

export const readerOutputSchema = z.strictObject({
  item_ref: z.string().describe("Candidate id the note is mainly about, or empty when unclear"),
  changes: z.array(readerChangeSchema),
  unclear: z.array(z.string()).describe("What the note leaves open, in short lines"),
});

export type ReaderChange = z.infer<typeof readerChangeSchema>;
export type ReaderOutput = z.infer<typeof readerOutputSchema>;
export type Dropped = { change: ReaderChange; reason: string };
