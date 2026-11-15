/**
 * Reads one note: one model call, then the code checks.
 *
 * The call goes through an injectable `complete`, so tests and the public demo
 * never reach the API. `READER=claude` with ANTHROPIC_API_KEY set uses the
 * official SDK; anything else answers from the fixture readings in
 * lib/reader/fixtures.ts.
 *
 * Structured output through `client.beta.messages.parse` with the reader's zod
 * schema, plus the server-side fallback on a refusal (`fallbacks: "default"`,
 * beta `server-side-fallback-2026-07-01`). Thinking is left at the model's
 * default (always on for this model) and effort is set explicitly.
 */
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { calendar } from "@/lib/ledger/dates";
import { moneyValue } from "@/lib/ledger/money";
import { stageOf } from "@/lib/ledger/stage";
import type { Item } from "@/lib/ledger/types";
import { checkReading } from "./check";
import { fixtureComplete } from "./fixtures";
import { READER_PROMPT } from "./prompt";
import { readerOutputSchema, type Dropped, type ReaderOutput } from "./schema";

export const READER_MODEL = "claude-opus-5-5";
export const READER_EFFORT = "low";
export const READER_MAX_TOKENS = 16_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type ReaderInput = { today: string; text: string; candidates: Item[] };

const zodFormat = betaZodOutputFormat(readerOutputSchema);
/** A reply that does not parse comes back as null, so its stop reason still reaches the caller. */
const READER_FORMAT = {
  ...zodFormat,
  parse(content: string): ReaderOutput | null {
    try {
      return zodFormat.parse(content);
    } catch {
      return null;
    }
  },
};

export type ReaderRequest = {
  model: typeof READER_MODEL;
  max_tokens: number;
  system: string;
  messages: [{ role: "user"; content: { type: "text"; text: string }[] }];
  output_config: { effort: typeof READER_EFFORT; format: typeof READER_FORMAT };
  betas: [typeof FALLBACK_BETA];
  fallbacks: "default";
};

export type ReaderCompletion = {
  stop_reason: string | null;
  parsed_output: ReaderOutput | null;
  usage: { input_tokens: number; output_tokens: number } | null;
};

/** One model call. The input rides along so the fixture reader can answer by note. */
export type Complete = (request: ReaderRequest, input: ReaderInput) => Promise<ReaderCompletion>;

export type ReaderResult =
  | { status: "ready"; output: ReaderOutput; raw: ReaderOutput; dropped: Dropped[]; source: "fixture" | "claude" }
  | { status: "failed"; error: string };

class NoApiKeyError extends Error {}

let client: Anthropic | null = null;

const claudeComplete: Complete = async (request) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new NoApiKeyError("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client.beta.messages.parse(request);
};

export const liveReader = (): boolean => process.env.READER === "claude";

/** The item as the model reads it: its field names, money in dollars. */
function candidateJson(item: Item) {
  const money = (c: number | null) => (c === null ? null : moneyValue(c));
  return {
    id: item.id,
    brand: item.brand,
    name: item.name,
    size: item.size,
    store: item.store,
    stage: stageOf(item),
    bought_on: item.boughtOn,
    due_on: item.dueOn,
    arrived_on: item.arrivedOn,
    posted_on: item.postedOn,
    posted_where: item.postedWhere,
    posted_price: money(item.postedPriceCents),
    sold_on: item.soldOn,
    sold_price: money(item.soldPriceCents),
    payout: money(item.payoutCents),
    paid: money(item.paidCents),
    paid_is_sticker: item.paidIsSticker,
  };
}

/** The note is wrapped, and a closing tag inside it is broken up so the note cannot end early. */
export function buildRequest(input: ReaderInput): ReaderRequest {
  const context = [
    `Today (the day the note was written): ${input.today}`,
    "",
    "Calendar, newest first:",
    ...calendar(input.today),
    "",
    "Candidate items (JSON):",
    JSON.stringify(input.candidates.map(candidateJson)),
  ].join("\n");
  const note = `<note>${input.text.replace(/<\/note/gi, "< /note")}</note>`;
  return {
    model: READER_MODEL,
    max_tokens: READER_MAX_TOKENS,
    system: READER_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: context }, { type: "text", text: note }] }],
    output_config: { effort: READER_EFFORT, format: READER_FORMAT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

export function errorCode(error: unknown): string {
  if (error instanceof NoApiKeyError) return "no_api_key";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIConnectionError) return "network";
  if (error instanceof APIError) return error.status ? `api_${error.status}` : "api_error";
  if (error instanceof Error && error.message === "no_fixture") return "no_fixture";
  return "error";
}

/** One reading of one note: the checked output, or why there is none. Never throws. */
export async function readNote(input: ReaderInput, complete?: Complete): Promise<ReaderResult> {
  const call = complete ?? (liveReader() ? claudeComplete : fixtureComplete);
  const source = call === claudeComplete ? "claude" : "fixture";
  let reply: ReaderCompletion;
  try {
    reply = await call(buildRequest(input), input);
  } catch (error) {
    return { status: "failed", error: errorCode(error) };
  }
  // The stop reason first: a refused or cut-off reply is a failure even when part of it parsed.
  if (reply.stop_reason === "refusal" || reply.stop_reason === "max_tokens") return { status: "failed", error: reply.stop_reason };
  if (!reply.parsed_output) return { status: "failed", error: "parse" };
  const { output, dropped } = checkReading(reply.parsed_output, input);
  return { status: "ready", output, raw: reply.parsed_output, dropped, source };
}
