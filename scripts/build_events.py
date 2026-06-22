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


def query(war):
    return f"""SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {{
  ?item wdt:P361 wd:{war} .
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


def run(war):
    url = WDQS + "?" + urllib.parse.urlencode({"query": query(war), "format": "json"})
    req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        bindings = json.load(r)["results"]["bindings"]
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
        country = (b.get("countryLabel") or {}).get("value")
        if country and not re.match(r"^Q\d+$", country):
            ev["data"] = {"country": country}
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
