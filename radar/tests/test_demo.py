from deal_radar import demo


def test_demo_runs_offline_and_tells_the_whole_story():
    lines: list[str] = []
    result = demo.run(out=lines.append, port=0)
    text = "\n".join(lines)
    assert result == {"carded": 4, "lookups": 6}
    for expected in ("baseline, 6 items recorded, no alerts", "benched, skipped", "304 not modified",
                     "likely the wrong comp", "needs -10% to card again", "position.bought event is queued",
                     "Benched: glasshouse"):
        assert expected in text, expected
