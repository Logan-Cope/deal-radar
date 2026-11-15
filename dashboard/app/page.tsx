import { resetDemo } from "@/app/actions";
import { EventLog } from "@/components/event-log";
import { Ledger } from "@/components/ledger";
import { Phone } from "@/components/phone";
import { Submit } from "@/components/submit";
import { sharedMode } from "@/lib/demo/sandbox";
import { session } from "@/lib/demo/session";
import { isTab } from "@/lib/ledger/stage";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { box } = await session();
  const { tab } = await searchParams;
  const demo = !sharedMode();
  return (
    <>
      <header className="masthead">
        <h1 className="wordmark">deal-radar</h1>
        <p>A radar watches stores for underpriced pieces and checks each one against what the rest of the market charges. Nothing is bought until a person taps.</p>
        {demo ? (
          <form action={resetDemo}>
            <Submit className="btn btn-quiet">Reset demo</Submit>
          </form>
        ) : null}
      </header>
      <main className={demo ? "desk" : "desk desk-shared"}>
        {demo ? <Phone box={box} /> : null}
        <Ledger box={box} tab={isTab(tab) ? tab : "all"} />
        {demo ? <EventLog box={box} /> : null}
      </main>
      {demo ? <footer className="footer-note">Every store, brand, price and person here is invented. This page has its own private copy of the data.</footer> : null}
    </>
  );
}
