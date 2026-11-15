from deal_radar.alerts.render import render_html
from deal_radar.engine import CycleReport
from deal_radar.models import Alert, Item


class FakeTelegram:
    """Configured for chat 1, records answers, never touches the network."""

    chat_id = "1"
    configured = True

    def __init__(self):
        self.answered = []

    def answer(self, callback_id, text):
        self.answered.append(text)

    def send(self, text, buttons=None):
        return True


def tap(update_id, data, chat=1):
    return {"callback_query": {"id": str(update_id), "data": data, "from": {"first_name": "Sam"},
                               "message": {"chat": {"id": chat}}}}


def reply(text, chat=1):
    return {"message": {"message_id": 5, "chat": {"id": chat}, "text": text, "from": {"first_name": "Sam"},
                        "reply_to_message": {"reply_markup": {"inline_keyboard": [[
                            {"text": "Bought", "callback_data": "dec:2:bought"}]]}}}}


def cycle(engine, server, n):
    server.cycle = n
    report = CycleReport()
    alerts = engine.comp_gate(engine.poll_stores(report), report)
    engine.dispatch(alerts, report)
    return report


def titles(report):
    return [a.item.title for _, a in report.carded]


def test_first_sight_of_a_store_is_a_silent_baseline(engine, server):
    report = cycle(engine, server, 1)
    assert report.carded == [] and report.stores["harbor-and-pine"].startswith("baseline")


def test_cycle_two_cards_only_what_the_comp_gate_passes(engine, server):
    cycle(engine, server, 1)
    report = cycle(engine, server, 2)
    assert titles(report) == ["Tessel Field Boot Tan", "Rowan Knit Cardigan Oat", "Halden Trench Coat Stone"]
    assert any("Arden Wrap Dress" in k and "KILL" in k for k in report.killed)
    assert any("Mira Shoulder Bag" in k and "wrong comp" in k for k in report.killed)
    assert "Linen Camp Shirt Sage" not in str(report.killed)  # -20% never reached the comp gate


def test_bot_wall_benches_the_store(engine, server):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    report = cycle(engine, server, 3)
    assert report.stores["glasshouse"] == "benched, skipped"


def test_cycle_three_dedupes_and_reuses_cached_comps(engine, server):
    for n in (1, 2):
        cycle(engine, server, n)
    lookups_before = len(engine.offers.queries)
    report = cycle(engine, server, 3)
    assert report.stores["atelier-nord"] == "304 not modified"
    assert any("Tessel Field Boot" in d for d in report.deduped)
    assert titles(report) == ["Pell Loafer Espresso"]
    assert len(engine.offers.queries) == lookups_before + 1  # only the loafer was new; the dress came from cache


def test_every_card_lands_in_the_outbox(engine, server, tmp_path):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    lines = "".join(p.read_text() for p in (tmp_path / "outbox").glob("*.jsonl"))
    assert lines.count('"kind": "alert"') == 3


def test_bought_tap_queues_a_ledger_event_and_undo_queues_removal(engine, server):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    engine.telegram = FakeTelegram()
    assert engine.handle_update(tap(77, "dec:1:bought")) == "bought"
    assert engine.handle_update(tap(77, "dec:1:bought")) == "bought"  # a repeated update queues nothing new
    assert engine.db.queue_stats()["waiting"] == 1
    assert engine.handle_update(tap(78, "dec:1:undo")) == "undone"
    assert engine.db.queue_stats()["waiting"] == 2
    assert engine.telegram.answered == ["Logged: bought", "Logged: bought", "Logged: undone"]


def test_a_reply_to_a_card_becomes_a_note(engine, server):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    engine.telegram = FakeTelegram()
    assert engine.handle_update(reply("got the 38")) == "noted"
    assert engine.db.alert(2)["note"] == "got the 38"


def test_updates_from_any_other_chat_are_ignored(engine, server):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    engine.telegram = FakeTelegram()
    assert engine.handle_update(tap(90, "dec:1:bought", chat=666)) is None
    assert engine.handle_update(reply("mark it sold", chat=666)) is None
    assert engine.handle_update({"callback_query": {"id": "91", "data": "dec:1:bought"}}) is None  # no chat at all
    assert engine.db.queue_stats()["waiting"] == 0
    assert engine.db.alert(1)["decision"] is None


def test_nothing_is_accepted_when_telegram_is_not_configured(engine, server):
    cycle(engine, server, 1)
    cycle(engine, server, 2)
    assert engine.handle_update(tap(92, "dec:1:bought")) is None


def test_malformed_callbacks_are_ignored(engine):
    engine.telegram = FakeTelegram()
    assert engine.handle_update(tap(1, "dec:abc:bought")) is None
    assert engine.handle_update(tap(2, "dec:999:bought")) == "unknown alert"
    assert engine.handle_update(tap(3, "dec:1:refund")) == "unknown decision"
    assert engine.db.queue_stats()["waiting"] == 0


def test_telegram_html_escapes_scraped_text():
    item = Item(id="i", store="s<b>", title="Dress <script>", url="https://x/?a=1&b=2", price=10, compare_at=100)
    text = render_html(Alert(item, "new", "BUY", "-90% off"))
    assert "<script>" not in text and "&lt;script&gt;" in text and "a=1&amp;b=2" in text
