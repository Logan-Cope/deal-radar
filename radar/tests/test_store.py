from deal_radar.models import Item


def item(price: float, available: bool = True) -> Item:
    return Item(id="shopify:s:1", store="s", title="T", url="u", price=price, compare_at=500, available=available)


def test_observe_reports_new_drop_and_restock(db):
    assert db.observe(item(100)).kind == "new"
    assert db.observe(item(100)) is None
    drop = db.observe(item(80))
    assert (drop.kind, drop.previous_price) == ("price_drop", 100)
    assert db.observe(item(80, available=False)) is None
    assert db.observe(item(80)).kind == "restock"


def test_store_is_benched_after_consecutive_errors_and_recovers(db, clock):
    assert not db.store_error("s", "boom", bench_after=2, cooldown_minutes=60)
    assert db.store_error("s", "boom", bench_after=2, cooldown_minutes=60)
    assert db.benched("s")
    clock.t += 61 * 60
    assert not db.benched("s")
    db.store_ok("s")
    assert db.unhealthy() == []


def test_enqueue_is_idempotent_per_event_id(db):
    assert db.enqueue({"id": "e1", "type": "x"})
    assert not db.enqueue({"id": "e1", "type": "x"})
    assert db.queue_stats() == {"waiting": 1, "parked": 0}


def test_due_pushes_stop_at_the_first_row_backing_off(db, clock):
    for i in (1, 2, 3):
        db.enqueue({"id": f"e{i}"})
    db.retry_push("e2", clock.t + 60, "timeout")
    assert [r["id"] for r in db.due_pushes(50)] == ["e1"]  # e3 must not overtake e2
