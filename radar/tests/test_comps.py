from deal_radar.comps import (
    Verdict,
    brand_keys,
    cache_key,
    describe,
    floor_of,
    fold,
    is_own_store,
    match_offers,
    score_comp,
    verdict_from_floor,
)

CFG = {"min_ratio": 2.5, "min_headroom": 150, "fee_rate": 0.136, "shipping": 18, "min_matches": 1,
       "scarce_min_brand_offers": 8, "outlier_guard_gap": 2.0, "outlier_guard_min_matches": 3}
BOOT = {"brand": "Orla Venn", "title": "Tessel Field Boot Tan", "price": 96.0, "store": "harbor-and-pine",
        "store_domain": "harborandpine.example"}


def offer(title: str, price: str, seller: str = "Northline Goods") -> dict:
    return {"title": title, "price": price, "seller": seller}


def test_fold_reads_ampersand_as_and():
    assert fold("Kessler & Rye") == fold("Kessler and Rye") == "kessler and rye"


def test_brand_keys_try_the_whole_name_then_its_longest_word():
    assert brand_keys("Marlow Atelier") == ["marlowatelier", "marlow"]


def test_cache_key_ignores_the_colourway():
    assert cache_key("Orla Venn", "Tessel Field Boot Tan") == cache_key("Orla Venn", "Tessel Field Boot Tide Stripe")


def test_own_store_is_excluded_for_this_item_only():
    assert is_own_store(BOOT, "Harbor and Pine")
    assert not is_own_store(BOOT, "Northline Goods")
    assert not is_own_store(BOOT, "H&P")  # too short to trust as a match


def test_match_drops_other_brands_mens_and_other_garments():
    offers = [
        offer("Orla Venn Tessel Field Boot", "$410"),
        offer("Orla Venn Men's Tessel Field Boot", "$180"),
        offer("Vantor Tessel Field Boot", "$90"),
        offer("Orla Venn Tessel Field Dress", "$120"),
        offer("Orla Venn Tessel Field Boot", "$96", seller="Harbor and Pine"),
    ]
    assert [o["_price"] for o in match_offers(BOOT, offers)] == [410.0]


def test_weak_tier_when_only_brand_and_type_match():
    matched = match_offers(BOOT, [offer("Orla Venn Cass Ankle Boot", "$300")])
    assert matched[0]["_tier"] == "brand+type"


def test_floor_skips_a_junk_listing_far_below_the_pack():
    pack = [{"_price": p, "seller": s} for p, s in ((40, "Junk"), (400, "A"), (410, "B"), (450, "C"))]
    assert floor_of(pack) == (400.0, "A")


def test_verdict_needs_both_ratio_and_headroom():
    assert verdict_from_floor(96, 410, 3, 5, CFG).verdict == Verdict.PASS
    assert verdict_from_floor(120, 150, 3, 5, CFG).verdict == Verdict.KILL      # ratio too low
    assert verdict_from_floor(20, 150, 3, 5, CFG).verdict == Verdict.KILL       # 7.5x, but $91 headroom


def test_scarce_needs_proof_the_search_works_for_the_brand():
    brand_wall = [offer(f"Orla Venn Model{i} Bag", "$300") for i in range(8)]
    assert score_comp(BOOT, brand_wall, CFG).verdict == Verdict.SCARCE
    assert score_comp(BOOT, brand_wall[:3], CFG).verdict == Verdict.UNPRICED
    assert score_comp(BOOT, [], CFG).verdict == Verdict.UNKNOWN


def test_thin_evidence_guard_kills_a_towering_lone_floor():
    bag = {"brand": "Isolde Park", "title": "Mira Shoulder Bag", "price": 129.0}
    offers = [offer("Isolde Park Mira Shoulder Bag", "$2,400.00", "Resale Row"),
              offer("Isolde Park Lune Earrings", "$190.00")]
    comp = score_comp(bag, offers, CFG)
    assert comp.verdict == Verdict.KILL and "likely the wrong comp" in comp.reason


def test_describe_says_cheapest_found_and_signs_negative_headroom():
    comp = score_comp(BOOT, [offer("Orla Venn Tessel Field Boot", "$410")], CFG)
    assert describe(comp).startswith("cheapest found $410 at Northline Goods")
    assert "-$8 headroom" in describe(verdict_from_floor(120, 150, 3, 5, CFG))
