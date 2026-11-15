"""Cards. One renderer for the terminal and the outbox, one for Telegram's HTML mode."""
from __future__ import annotations

import html

from ..models import Alert, Headline

KIND_LABELS = {"new": "New find", "price_drop": "Price drop", "restock": "Restock"}


def _lines(alert: Alert) -> list[str]:
    item = alert.item
    title = item.title if not item.brand or item.brand.lower() in item.title.lower() else f"{item.brand}, {item.title}"
    price = f"{item.store} · ${item.price:,.2f}"
    if item.compare_at and item.discount_pct:
        price += f" (was ${item.compare_at:,.2f}, -{item.discount_pct:.0f}%)"
    elif alert.previous_price:
        price += f" (was ${alert.previous_price:,.2f})"
    # The comp verdict rides in the reason after " · ". It gets its own line so
    # the evidence (what other sellers are asking) reads apart from the discount.
    why, _, comp = alert.reason.partition(" · ")
    lines = [f"{alert.verdict} · {KIND_LABELS.get(alert.kind, alert.kind)}", title, price]
    if item.sizes_in_stock:
        shown = ", ".join(item.sizes_in_stock[:8])
        more = f" +{len(item.sizes_in_stock) - 8}" if len(item.sizes_in_stock) > 8 else ""
        lines.append(f"Sizes: {shown}{more}")
    lines.append(f"Why: {why}")
    if comp:
        lines.append(f"Comp: {comp}")
    return lines


def render_text(alert: Alert, alert_id: int | None = None) -> str:
    lines = _lines(alert)
    head = f"#{alert_id} {lines[0]}" if alert_id is not None else lines[0]
    return "\n".join([head, *lines[1:], alert.item.url])


def render_html(alert: Alert) -> str:
    """Telegram HTML. Every scraped string is escaped: one stray '<' in a product
    title makes Telegram reject the whole message."""
    lines = [html.escape(x, quote=True) for x in _lines(alert)]
    lines[0], lines[1] = f"<b>{lines[0]}</b>", f"<b>{lines[1]}</b>"
    lines.append(f'<a href="{html.escape(alert.item.url, quote=True)}">Open product page</a>')
    return "\n".join(lines)


def decision_buttons(alert_id: int) -> list[tuple[str, str]]:
    """The buttons carry the alert id, so one tap is the whole decision."""
    return [("Bought", f"dec:{alert_id}:bought"), ("Skip", f"dec:{alert_id}:skipped")]


def render_headline(h: Headline) -> str:
    return f"DROP · {h.title}\n{h.feed} · {h.reason}\n{h.url}"


def render_digest(overflow: int) -> str:
    return f"...and {overflow} more finds this cycle, in the outbox. The bars may be loose, or a sale just started."


def render_heartbeat(watching: int, benched: list[str], alerts_24h: int, queue: dict[str, int]) -> str:
    """Daily proof of life. Without it a broken radar and a quiet week look the same."""
    lines = ["Heartbeat", f"Watching {watching} stores · {alerts_24h} alerts in the last 24h"]
    lines.append(f"Benched: {', '.join(benched)}" if benched else "All stores healthy")
    lines.append(f"Ledger queue: {queue['waiting']} waiting, {queue['parked']} parked")
    return "\n".join(lines)
