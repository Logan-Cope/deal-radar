import type { Via } from "./types";

const VIA: Record<Via, string> = {
  app: "in the ledger",
  telegram: "from Telegram",
  cli: "from the terminal",
  phone: "from the phone",
};

/** `Sam, from Telegram`: who wrote something and through which channel. */
export const byline = (actor: string, via: Via): string => `${actor}, ${VIA[via]}`;
