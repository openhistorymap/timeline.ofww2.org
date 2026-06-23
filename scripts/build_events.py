#!/usr/bin/env python3
"""
Bake this war's events to public/events.json (the app loads it at runtime — no
WDQS rate limits). Pulls every Wikidata item that is `part of` (P361) the war
and has a date, into the timel.in normalized event shape:
{ id, year, endYear?, title, description?, url?, data: { country? } }.

    python3 scripts/build_events.py            # uses WAR below
    python3 scripts/build_events.py Q362 out   # override war / output dir
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

WAR = "Q362"  # World War II
WDQS = "https://query.wikidata.org/sparql"
UA = "OpenHistoryMap-war-timeline/1.0 (https://github.com/openhistorymap)"

# Curated key events that aren't reachable by the generic query (no direct edge
# to the war). Treated as "key" events (emphasised, like the causes). For WWI the
# closing peace treaties: the generic war↔treaty link doesn't exist in Wikidata.
SEED = {
    "Q361": ["Q8736", "Q192924", "Q269267"],  # Versailles, Saint-Germain, Neuilly (1919)
    "Q362": [],
}


def query(war):
    return f"""SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {{
  {{ ?item wdt:P361 wd:{war} . }}                 # part of the war
  UNION {{ wd:{war} wdt:P828 ?item . }}           # the war's causes
  UNION {{ wd:{war} wdt:P1478 ?item . }}          # the war's immediate cause
  UNION {{ ?item wdt:P1542 wd:{war} . }}          # events whose effect is the war (e.g. the assassination)
  ?item wdt:P31 ?class .
  OPTIONAL {{ ?item wdt:P585 ?pit. }}
  OPTIONAL {{ ?item wdt:P580 ?st. }}
  OPTIONAL {{ ?item wdt:P582 ?et. }}
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  OPTIONAL {{ ?item wdt:P17 ?country. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?date
LIMIT 3000"""


def parse_year(s):
    if not s:
        return None
    m = re.match(r"^\s*([+-]?)(\d+)-(\d{2})-(\d{2})", s)
    if not m:
        return None
    sign = -1 if m.group(1) == "-" else 1
    y, mo, d = int(m.group(2)), int(m.group(3)), int(m.group(4))
    frac = ((mo - 1) / 12 if mo > 0 else 0) + ((d - 1) / (12 * 31) if d > 0 else 0)
    return round(sign * y + frac, 6)


def causes_query(war):
    # Tiny companion query: just the QIDs of the war's causes / igniting events.
    # (Kept separate so the main query stays fast — folding this in times WDQS out.)
    return f"""SELECT ?item WHERE {{
  {{ wd:{war} wdt:P828 ?item . }}
  UNION {{ wd:{war} wdt:P1478 ?item . }}
  UNION {{ ?item wdt:P1542 wd:{war} . }}
}}"""


def seed_query(qids):
    values = " ".join("wd:" + q for q in qids)
    return f"""SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {{
  VALUES ?item {{ {values} }}
  ?item wdt:P31 ?class .
  OPTIONAL {{ ?item wdt:P585 ?pit. }}
  OPTIONAL {{ ?item wdt:P580 ?st. }}
  OPTIONAL {{ ?item wdt:P582 ?et. }}
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  OPTIONAL {{ ?item wdt:P17 ?country. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""


def fetch(q):
    url = WDQS + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["results"]["bindings"]


def run(war):
    seeds = SEED.get(war, [])
    bindings = fetch(query(war)) + (fetch(seed_query(seeds)) if seeds else [])
    # Causes (auto-detected) and curated seeds are both "key" events → emphasised.
    cause_ids = {(b.get("item") or {}).get("value", "").rsplit("/", 1)[-1] for b in fetch(causes_query(war))}
    cause_ids |= set(seeds)
    out, seen = [], set()
    for b in bindings:
        uri = (b.get("item") or {}).get("value", "")
        qid = uri.rsplit("/", 1)[-1] or uri
        year = parse_year((b.get("date") or {}).get("value"))
        if not qid or qid in seen or year is None:
            continue
        seen.add(qid)
        ev = {"id": qid, "year": year, "title": (b.get("itemLabel") or {}).get("value", qid)}
        end = parse_year((b.get("endDate") or {}).get("value"))
        if end is not None and end > year:
            ev["endYear"] = end
        cls = (b.get("classLabel") or {}).get("value")
        if cls:
            ev["description"] = cls
        if uri:
            ev["url"] = uri
        data = {}
        country = (b.get("countryLabel") or {}).get("value")
        if country and not re.match(r"^Q\d+$", country):
            data["country"] = country
        if qid in cause_ids:
            data["cause"] = True
        if data:
            ev["data"] = data
        out.append(ev)
    return out


def main():
    war = sys.argv[1] if len(sys.argv) > 1 else WAR
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "public")
    events = run(war)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "events.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{war}: {len(events)} events → {path}")


if __name__ == "__main__":
    main()
