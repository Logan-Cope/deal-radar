/**
 * Scores the reader on evals/reader/cases.ts and prints the table and the gate.
 *
 *   npm run eval:reader            the fixture readings, no network (what CI checks)
 *   READER=claude ANTHROPIC_API_KEY=... npm run eval:reader -- --runs 3
 *                                  the live model, each case read --runs times
 *
 * Exits 1 when the gate fails.
 */
import { CASES } from "../evals/reader/cases";
import { GATE, report, scoreCase, type CaseScore } from "../evals/reader/score";
import { seedState } from "../lib/demo/seed";
import { toDay } from "../lib/ledger/dates";
import { liveReader, readNote } from "../lib/reader/read";

async function main() {
  const runsArg = process.argv.indexOf("--runs");
  const runs = runsArg > 0 ? Math.max(1, Number(process.argv[runsArg + 1]) || 1) : 1;
  const today = toDay(Date.now());
  const state = seedState(today);
  const scores: CaseScore[] = [];
  const failures: string[] = [];

  for (let run = 0; run < runs; run++) {
    for (const c of CASES) {
      const item = state.items.get(c.itemId);
      if (!item) throw new Error(`case ${c.id}: no item ${c.itemId}`);
      const result = await readNote({ today, text: c.note, candidates: [item] });
      if (result.status === "failed") failures.push(`${c.id}: ${result.error}`);
      scores.push(scoreCase(c, result.status === "ready" ? result.output : null, today));
    }
  }

  const r = report(scores);
  console.log(`reader: ${liveReader() ? "claude (live)" : "fixtures"}, ${CASES.length} cases x ${runs} run(s)\n`);
  console.log("case                  expected  proposed  correct  wrong / missed");
  for (const s of r.cases) {
    const notes = [...s.wrong.map((w) => `+${w}`), ...s.missed.map((m) => `-${m}`)].join(" ");
    console.log(`${s.id.padEnd(22)}${String(s.expected).padStart(8)}${String(s.proposed).padStart(10)}${String(s.correct).padStart(9)}  ${notes}`);
  }
  if (failures.length) console.log(`\nfailed readings: ${failures.join(", ")}`);
  console.log(`\nprecision ${r.precision.toFixed(3)} (gate ${GATE.precision}), recall ${r.recall.toFixed(3)} (gate ${GATE.recall})`);
  console.log(`gate: ${r.pass ? "PASS" : "FAIL"}`);
  process.exit(r.pass ? 0 : 1);
}

void main();
