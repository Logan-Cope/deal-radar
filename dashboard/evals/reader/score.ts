/**
 * Scores readings against the cases: precision and recall over (field, value)
 * pairs, plus a count of changes proposed on negative cases. The ship gate is
 * precision 1.0 (nothing wrong reaches a person) and recall of at least 0.9.
 */
import { addDays } from "@/lib/ledger/dates";
import type { ReaderOutput } from "@/lib/reader/schema";
import type { Case } from "./cases";

export const GATE = { precision: 1, recall: 0.9 };

export type CaseScore = { id: string; expected: number; proposed: number; correct: number; wrong: string[]; missed: string[] };
export type Report = { cases: CaseScore[]; precision: number; recall: number; pass: boolean };

const key = (field: string, value: string) => `${field}=${value}`;

export function scoreCase(c: Case, output: ReaderOutput | null, today: string): CaseScore {
  const want = new Set(c.expect.map((e) => key(e.field, typeof e.value === "string" ? e.value : addDays(today, -e.value.daysAgo))));
  const got = (output?.changes ?? []).filter((ch) => ch.item_ref === c.itemId).map((ch) => key(ch.field, ch.value));
  const correct = got.filter((g) => want.has(g));
  return {
    id: c.id,
    expected: want.size,
    proposed: got.length,
    correct: correct.length,
    wrong: got.filter((g) => !want.has(g)),
    missed: [...want].filter((w) => !got.includes(w)),
  };
}

export function report(scores: CaseScore[]): Report {
  const proposed = scores.reduce((s, c) => s + c.proposed, 0);
  const expected = scores.reduce((s, c) => s + c.expected, 0);
  const correct = scores.reduce((s, c) => s + c.correct, 0);
  const precision = proposed === 0 ? 1 : correct / proposed;
  const recall = expected === 0 ? 1 : correct / expected;
  return { cases: scores, precision, recall, pass: precision >= GATE.precision && recall >= GATE.recall };
}
