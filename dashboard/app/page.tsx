import { resetDemo } from "@/app/actions";
import { EventLog } from "@/components/event-log";
import { Ledger } from "@/components/ledger";
import { Phone } from "@/components/phone";
import { Submit } from "@/components/submit";
import { session } from "@/lib/demo/session";
import { isTab } from "@/lib/ledger/stage";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string; problem?: string }> }) {
  const s = await session();
  const { tab, problem } = await searchParams;
  const demo = s.mode === "demo";
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
      {problem ? (
        <p className="problem page-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <main className={demo ? "desk" : "desk desk-shared"}>
        {demo ? <Phone box={s.box} /> : null}
        <Ledger box={s.box} tab={isTab(tab) ? tab : "all"} />
        {demo ? <EventLog box={s.box} /> : null}
      </main>
      {demo ? <footer className="footer-note">Every store, brand, price and person here is invented. What you do here is kept in your own browser only.</footer> : null}
    </>
  );
}
