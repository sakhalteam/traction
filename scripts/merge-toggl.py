#!/usr/bin/env python3
"""
Merge a Toggl detailed-report CSV into an EXISTING traction backup (run 2026-08-28).

Where toggl-to-traction.py built the original state from nothing, this one
reconciles Toggl against hours that have since been logged in traction itself.

    python scripts/merge-toggl.py <backup.json> <toggl.csv> [-o merged.json]
    python scripts/merge-toggl.py <backup.json> <toggl.csv> --dry-run

The merge rule, per Nic: Toggl is the more accurate clock.
  * For any (client, day) BOTH sources know about, Toggl's entries replace
    traction's for that day outright -- traction's hand-typed 9am is a guess,
    Toggl's 13:23 is a measurement. Replacement is per DAY, not per entry, so a
    traction day holding one entry can be replaced by Toggl's two.
  * A (client, day) only traction knows about is kept untouched. That is what
    protects everything logged since the Toggl export was taken.
  * A (client, day) only Toggl knows about is added.
  * An entry already on an invoice is NEVER replaced -- a frozen invoice has to
    keep matching its entries. Collisions there are reported, not applied.

Client names always come from traction, which has the good ones, and every
client moves onto the structured first/last/business scheme at the same time.
Rates come from traction too (per-client override -> service default): Toggl
carries no rate data at all.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import random
import re
import string
from collections import defaultdict

# Split "Larry and Linda" / "Marlene + Jeanette" / "A & B". Written without
# backslash escapes so the pattern survives being edited through a shell.
SPLIT_PEOPLE = re.compile("[ ]+(?:[&+]|and)[ ]+", re.I)

# ---- Toggl identity -> traction client -------------------------------------
# Toggl's 2026 rows have an empty Client column (mobile can't set one), so
# identity hides in Project + Description. Values are the traction client
# `name` to attach to, or a NEW client name to create.
IDENTITY = {
    ("", "Stein"):                         "Stein",
    ("GIES", "Larry Linda"):               "Gies, Larry and Linda",
    ("", "John house"):                    "John",
    ("Cathy", "Cathy"):                    "Cathy Tanner",
    ("", "Gallagher"):                     "Gallagher",                    # not yet in traction
    ("marlene", "Marlene"):                "Schurr, Marlene and Lorraine",
    ("", "MacArthur @pressure washing"):   "MacArthur, Grayson and Colleen",
    ("pressurewashing", "Diana"):          "Diana Baskins",
    ("pressurewashing", "Sylvia Gardner"): "Gardner, Sylvia and Craig",
}

# Which traction service each identity's work is, by traction service name.
SERVICE = {
    "Stein":                          "Gardening",
    "Gies, Larry and Linda":          "Gardening",
    "John":                           "Gardening",
    "Cathy Tanner":                   "Gardening",
    "Gallagher":                      "Gardening",
    "Schurr, Marlene and Lorraine":   "Pressure Washing",
    "MacArthur, Grayson and Colleen": "Pressure Washing",
    "Diana Baskins":                  "Pressure Washing",
    "Gardner, Sylvia and Craig":      "Pressure Washing",
}

# Structured names for traction's existing single-line ones. Explicit rather
# than parsed, because "Stein" alone is a surname while "Cathy Tanner" is a
# first and a surname, and no heuristic tells those apart. Anything missing
# here falls back to parse_people().
NAMES: dict[str, list[tuple[str, str]]] = {
    "Stein":                          [("Maija", "Stein"), ("Louis", "Stein")],
    "Gies, Larry and Linda":          [("Larry", "Gies"), ("Linda", "Gies")],
    "John":                           [("John", "")],
    "Cathy Tanner":                   [("Cathy", "Tanner")],
    "Gallagher":                      [("", "Gallagher")],
    "Schurr, Marlene and Lorraine":   [("Marlene", "Schurr"), ("Lorraine", "Schurr")],
    "MacArthur, Grayson and Colleen": [("Grayson", "MacArthur"), ("Colleen", "MacArthur")],
    "Diana Baskins":                  [("Diana", "Baskins")],
    "Gardner, Sylvia and Craig":      [("Sylvia", "Gardner"), ("Craig", "Gardner")],
    "Patrick Crossfity":              [("Patrick", "Crossfity")],
}

# Stored invoice codes to CLEAR, so the app's derived initials+surname rule
# takes over. SYLVGARD, PATCROSS and LLGIES are Nic's own and stay put.
CLEAR_CODES = {
    "Diana Baskins",                  # DIANABASKINS -> DBASKINS
    "Stein",                          # STEINLOUMAI  -> MLSTEIN
    "MacArthur, Grayson and Colleen",  # MACARTHUR    -> GCMACARTHUR
    "Schurr, Marlene and Lorraine",   # SCHURRMARLOR -> MJSCHURR (Jeanette, not Lorraine)
    "Cathy Tanner",                   # CATHY        -> CTANNER
}

# Contact details and corrections Nic supplied after the first merge pass.
# Applied by traction client name; `people` here overrides NAMES.
DETAILS: dict[str, dict] = {
    "Schurr, Marlene and Lorraine": {
        # Lorraine was their mother, and was only on the property paperwork.
        "people": [("Marlene", "Schurr"), ("Jeanette", "Schurr")],
        "address": "19710 9th Dr SE, Bothell, WA 98012",
    },
    "John": {
        "people": [("John", "Welk")],
        "address": "19704 9th Dr SE, Bothell, WA 98012",
    },
    "Gallagher": {
        "people": [("Leanne", "Gallagher")],
        "address": "115 Crandell Ln, Wenatchee, WA 98801",
    },
}

# Client -> date through which everything is settled, regardless of Toggl's
# tagging. Nic tagged #paid by hand and missed some, so the tag understates
# what was actually collected. Entries on or BEFORE this date count as paid.
PAID_THROUGH = {
    "Gies, Larry and Linda": "2026-07-27",  # paid up until (not including) Jul 28
}

# Every client whose rate is a flat number across the board. Written as one
# figure rather than a per-service table because that is how these are actually
# quoted, and it keeps the new services below from silently falling back to a
# default that was never agreed.
FLAT_RATE = {
    "Diana Baskins": 43,
    "Gardner, Sylvia and Craig": 75,
    "Schurr, Marlene and Lorraine": 50,
    "John": 30,
}

# Services Nic offers that traction didn't know about yet. The Toggl export
# carries no service detail of its own -- its Project column holds client names
# ("GIES", "Cathy", "marlene"), and the only work word anywhere in it is
# "pressurewashing", which is already a service. So this list is Nic's, not
# something recovered from the data.
NEW_SERVICES = [
    ("Deadheading", "#84cc16"), ("Cleanup", "#10b981"), ("Pruning", "#14b8a6"),
    ("Gutter Cleaning", "#6366f1"), ("Path Creation", "#8b5cf6"),
    ("Landscaping", "#22c55e"), ("Potting", "#ec4899"), ("Planting", "#f43f5e"),
    ("Dump Run", "#64748b"), ("Fence Staining", "#f97316"), ("Repair", "#eab308"),
    ("Irrigation", "#0ea5e9"), ("Painting", "#a78bfa"), ("Chores/Errands", "#94a3b8"),
]

# Default $/hr for those new services: Nic's standard gardening rate, which the
# three existing $30 services already use. Per-client rates still win.
NEW_SERVICE_RATE = 30

# Historical rates that differ from what traction would resolve today. The
# MacArthur jobs are June 2026, priced before Pressure Washing moved to $75;
# the first import recorded $50 and that is what was actually charged. Set on
# the imported ENTRIES only -- the client keeps no override, so anything new
# bills at today's price.
HISTORICAL_RATE = {
    "MacArthur, Grayson and Colleen": 50,
}

# Colour for clients this merge creates (they arrive with none).
NEW_CLIENT_COLOR = "slate"

# Payment terms stamped on backfilled invoices, matching settings.netDays.
NET_DAYS = 30

_rng = random.Random(20260828)  # deterministic: same inputs -> same file


def gen_id() -> str:
    """Same shape as store.ts genId(): 8 base36 chars + a base36 timestamp."""
    return "".join(_rng.choice(string.ascii_lowercase + string.digits)
                   for _ in range(8)) + format(_rng.randrange(36 ** 8), "x")


def epoch_ms(date_str: str, time_str: str) -> int:
    """Local wall-clock -> epoch ms (naive .timestamp() uses the machine tz)."""
    return int(datetime.datetime.fromisoformat(date_str + "T" + time_str).timestamp() * 1000)


def hhmm(ms: int | None) -> str:
    if not ms:
        return "--:--"
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%H:%M")


def span(entry: dict) -> str:
    start = entry.get("startedAt")
    if not start:
        return "  (no clock time) "
    return hhmm(start) + "-" + hhmm(start + entry["seconds"] * 1000)


def parse_people(name: str) -> list[tuple[str, str]]:
    """Fallback split for a name NAMES doesn't cover. 'Last, A and B' aware."""
    if "," in name:
        last, rest = name.split(",", 1)
        firsts = SPLIT_PEOPLE.split(rest.strip())
        return [(f.strip(), last.strip()) for f in firsts if f.strip()]
    out = []
    for chunk in SPLIT_PEOPLE.split(name.strip()):
        tokens = chunk.split()
        if len(tokens) == 1:
            out.append((tokens[0], ""))
        elif tokens:
            out.append((" ".join(tokens[:-1]), tokens[-1]))
    return out or [(name.strip(), "")]


def resolve_rate(client: dict, service: dict) -> float:
    """store.ts resolveRate(): per-client override, else the service default."""
    override = (client.get("rates") or {}).get(service["id"])
    return override if override is not None else service.get("defaultRate", 0)


def line_amount(seconds: int, rate: float) -> float:
    """store.ts lineAmount()."""
    return round(seconds / 3600 * rate, 2)


def add_days(iso: str, days: int) -> str:
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=days)).isoformat()


def normalize_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isascii() and ch.isalnum())


def invoice_code(client: dict) -> str:
    """Port of store.ts clientInvoiceCode(): initials + surname, custom wins."""
    custom = normalize_code(client.get("invoiceCode") or "")
    if custom:
        return custom
    business = (client.get("business") or "").strip()
    if business:
        return normalize_code(business) or "CLIENT"
    people = [p for p in client.get("people", []) if p["first"].strip() or p["last"].strip()]
    initials = "".join(p["first"].strip()[:1] for p in people if p["first"].strip())
    lasts = [p["last"].strip() for p in people if p["last"].strip()]
    code = (initials + lasts[0]) if lasts else "".join(p["first"].strip() for p in people)
    return normalize_code(code) or "CLIENT"


def next_number(existing: list[str], code: str, issued: str) -> str:
    """Port of store.ts nextInvoiceNumber(): CODE-YYYYMMDD-NN."""
    prefix = code + "-" + issued.replace("-", "") + "-"
    highest = 0
    for number in existing:
        if number.startswith(prefix):
            tail = number[len(prefix):]
            if tail.isdigit():
                highest = max(highest, int(tail))
    return prefix + str(highest + 1).zfill(2)


def build_breakdown(entries: list[dict], service_names: dict[str, str]) -> dict:
    """Faithful port of store.ts buildBreakdown() so snapshots match the app."""
    by_date: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_date[e["date"]].append(e)

    days, total, total_seconds = [], 0.0, 0
    for date in sorted(by_date):
        by_line: dict[str, dict] = {}
        for e in by_date[date]:
            key = e["serviceId"] + "::" + str(e["rate"])
            if key in by_line:
                by_line[key]["seconds"] += e["seconds"]
                note = e["note"].strip()
                if note and note not in by_line[key]["notes"]:
                    by_line[key]["notes"].append(note)
            else:
                by_line[key] = {
                    "serviceId": e["serviceId"],
                    "serviceName": service_names[e["serviceId"]],
                    "notes": [e["note"].strip()] if e["note"].strip() else [],
                    "seconds": e["seconds"], "rate": e["rate"], "amount": 0,
                }
        lines = sorted(by_line.values(), key=lambda x: x["serviceName"])
        day_seconds, day_total = 0, 0.0
        for ln in lines:
            ln["amount"] = line_amount(ln["seconds"], ln["rate"])
            day_seconds += ln["seconds"]
            day_total += ln["amount"]
        days.append({"date": date, "lines": lines,
                     "daySeconds": day_seconds, "dayTotal": round(day_total, 2)})
        total += round(day_total, 2)
        total_seconds += day_seconds

    return {"days": days, "totalSeconds": total_seconds, "total": round(total, 2)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("backup", help="traction backup JSON to merge INTO")
    ap.add_argument("toggl", help="Toggl detailed-report CSV")
    ap.add_argument("-o", "--out", default="traction-merged.json")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    with open(args.backup, encoding="utf-8") as fh:
        doc = json.load(fh)
    state = doc.get("state", doc)
    now_ms = int(datetime.datetime.now().timestamp() * 1000)

    clients = state["clients"]
    services = state["services"]
    by_name = {c["name"]: c for c in clients}
    svc_by_name = {s["name"]: s for s in services}
    invoiced = {eid for inv in state.get("invoices", []) for eid in inv.get("entryIds", [])}

    # --- 1. Services: add the ones Nic offers that traction lacks ---------
    have = {s["name"] for s in services}
    for name, color in NEW_SERVICES:
        if name in have:
            continue
        services.append({"id": gen_id(), "name": name, "defaultRate": NEW_SERVICE_RATE,
                         "color": color, "archived": False, "createdAt": now_ms})
    svc_by_name = {s["name"]: s for s in services}

    # --- 2. Every client onto the structured name scheme ------------------
    for c in clients:
        detail = DETAILS.get(c["name"], {})
        people = detail.get("people") or NAMES.get(c["name"]) or parse_people(c["name"])
        c["people"] = [{"first": f, "last": l} for f, l in people]
        c.setdefault("business", "")
        if detail.get("address"):
            c["address"] = detail["address"]
        if c["name"] in CLEAR_CODES:
            c.pop("invoiceCode", None)
        # A flat-rate client keeps that rate on EVERY service, including the
        # ones just added -- otherwise their next job silently bills at the
        # service default instead of what was agreed.
        if c["name"] in FLAT_RATE:
            c["rates"] = {s["id"]: FLAT_RATE[c["name"]] for s in services}

    # --- 3. Toggl rows -> candidate entries, bucketed by client-day -------
    unmapped: list[tuple] = []
    toggl_days: dict[tuple[str, str], list[dict]] = defaultdict(list)

    with open(args.toggl, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    for r in rows:
        key = (r["Project"].strip(), r["Description"].strip())
        cname = IDENTITY.get(key)
        if cname is None:
            unmapped.append((key, r["Start date"], r["Duration"]))
            continue

        if cname not in by_name:  # a client Toggl knows and traction doesn't
            detail = DETAILS.get(cname, {})
            people = detail.get("people") or NAMES.get(cname) or parse_people(cname)
            fresh = {
                "id": gen_id(), "name": cname, "email": "", "phone": "",
                "address": detail.get("address", ""),
                "notes": "", "archived": False, "createdAt": now_ms,
                "colorId": NEW_CLIENT_COLOR, "business": "",
                "people": [{"first": f, "last": l} for f, l in people],
                "rates": ({s["id"]: FLAT_RATE[cname] for s in services}
                          if cname in FLAT_RATE else {}),
            }
            clients.append(fresh)
            by_name[cname] = fresh

        client = by_name[cname]
        service = svc_by_name[SERVICE[cname]]
        start = epoch_ms(r["Start date"], r["Start time"])
        end = epoch_ms(r["End date"], r["End time"])

        toggl_days[(client["id"], r["Start date"])].append({
            "id": gen_id(), "clientId": client["id"], "serviceId": service["id"],
            "note": "", "date": r["Start date"], "startedAt": start,
            "seconds": round((end - start) / 1000), "runningSince": None,
            "rate": HISTORICAL_RATE.get(cname, resolve_rate(client, service)),
            "invoiceId": None,
            "photoPaths": [], "createdAt": start,
            "_paid": "paid" in (r["Tags"] or "").lower(),
        })

    # --- 4. Reconcile, day by day ----------------------------------------
    name_of = {c["id"]: c["name"] for c in clients}
    kept, replaced, added, blocked = [], [], [], []

    traction_days: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for e in state["entries"]:
        traction_days[(e["clientId"], e["date"])].append(e)

    merged: list[dict] = []
    for key, existing in traction_days.items():
        if key not in toggl_days:
            merged.extend(existing)  # traction-only day: untouched
            kept.append((key, existing))
        elif any(e["id"] in invoiced for e in existing):
            merged.extend(existing)  # never rewrite invoiced hours
            toggl_days.pop(key)
            blocked.append((key, existing))
        else:
            replaced.append((key, existing, toggl_days[key]))
            merged.extend(toggl_days.pop(key))

    for key, entries in toggl_days.items():  # Toggl-only days
        merged.extend(entries)
        added.append((key, entries))

    # --- 5. Backfill closed invoices for work already settled -------------
    # Without this, 217h of collected work reads as money still owed and the
    # Ready-to-invoice nudge names every client. One invoice per client per
    # year, closed and paid, which also stamps invoiceId so those hours can
    # never be billed a second time. Untagged hours stay unbilled on purpose.
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for e in merged:
        tagged = e.pop("_paid", False)
        # PAID_THROUGH catches what the hand-applied #paid tag missed, and
        # applies to traction's own entries too, not just imported ones.
        through = PAID_THROUGH.get(name_of.get(e["clientId"], ""))
        if e.get("invoiceId"):
            continue
        if tagged or (through and e["date"] <= through):
            buckets[(e["clientId"], e["date"][:4])].append(e)

    service_names = {s["id"]: s["name"] for s in services}
    client_by_id = {c["id"]: c for c in clients}
    numbers = [i["number"] for i in state.get("invoices", [])]
    invoices = state.setdefault("invoices", [])

    for cid, year in sorted(buckets, key=lambda k: (min(e["date"] for e in buckets[k]),
                                                    name_of[k[0]])):
        billed = sorted(buckets[(cid, year)], key=lambda e: e["date"])
        inv_id = gen_id()
        for e in billed:
            e["invoiceId"] = inv_id
        period_start, period_end = billed[0]["date"], billed[-1]["date"]
        # Issued on the last day worked, not today: the app dates an
        # already-paid invoice by the work, so Reports puts it in the right
        # month instead of dumping a year of income into August.
        number = next_number(numbers, invoice_code(client_by_id[cid]), period_end)
        numbers.append(number)
        invoices.append({
            "id": inv_id, "clientId": cid, "number": number,
            "issuedDate": period_end, "dueDate": add_days(period_end, NET_DAYS),
            "periodStart": period_start, "periodEnd": period_end,
            "entryIds": [e["id"] for e in billed],
            "snapshot": build_breakdown(billed, service_names),
            "expenseIds": [], "expensesSnapshot": [],
            "status": "paid", "paidDate": period_end,
            "notes": "Backfilled from Toggl (" + year + "). Paid at time of service.",
            "createdAt": now_ms,
        })

    paid_seconds = sum(e["seconds"] for b in buckets.values() for e in b)
    state["entries"] = sorted(merged, key=lambda e: (e["date"], e.get("startedAt") or 0))

    # --- 6. Report --------------------------------------------------------
    def label(key: tuple[str, str]) -> str:
        return name_of.get(key[0], "?") + "  " + key[1]

    print()
    print("=== CLIENTS -> structured names ===")
    for c in sorted(clients, key=lambda c: c["name"]):
        who = " & ".join((p["first"] + " " + p["last"]).strip() for p in c["people"])
        code = c.get("invoiceCode") or "(derived)"
        print("  {:<34} -> {:<30} code={}".format(c["name"], who, code))

    print()
    print("=== DAYS REPLACED BY TOGGL ({}) ===".format(len(replaced)))
    for key, old, new in sorted(replaced, key=lambda r: r[0][1]):
        print("  " + label(key))
        for e in old:
            print("      was  {}  {:>5.2f}h  ${}".format(span(e), e["seconds"] / 3600, e["rate"]))
        for e in new:
            print("      now  {}  {:>5.2f}h  ${}".format(span(e), e["seconds"] / 3600, e["rate"]))

    print()
    print("=== TRACTION DAYS KEPT ({}) ===".format(len(kept)))
    for key, entries in sorted(kept, key=lambda r: r[0][1]):
        print("  {:<44} {:>5.2f}h".format(label(key), sum(e["seconds"] for e in entries) / 3600))

    if blocked:
        print()
        print("=== BLOCKED: on an invoice, left alone ({}) ===".format(len(blocked)))
        for key, _ in blocked:
            print("  " + label(key))

    print()
    print("=== ADDED FROM TOGGL ({} entries over {} days) ==="
          .format(sum(len(e) for _, e in added), len(added)))
    per_client: dict[str, list] = defaultdict(list)
    for key, entries in added:
        per_client[name_of.get(key[0], "?")].extend(entries)
    for cname in sorted(per_client):
        entries = per_client[cname]
        hours = sum(e["seconds"] for e in entries) / 3600
        amount = sum(line_amount(e["seconds"], e["rate"]) for e in entries)
        rates = sorted({e["rate"] for e in entries})
        print("  {:<34} {:>3} entries {:>7.2f}h  ${:>9,.2f}  @ {}"
              .format(cname, len(entries), hours, amount, rates))

    if unmapped:
        print()
        print("=== UNMAPPED TOGGL ROWS ({}) ===".format(len(unmapped)))
        for key, date, dur in unmapped:
            print("  {} {} {}h".format(key, date, dur))

    print()
    print("=== PAID INVOICES BACKFILLED ({}) ===".format(len(invoices)))
    for inv in sorted(invoices, key=lambda i: i["issuedDate"]):
        print("  {:<22} {:<12} {:>3} entries  ${:>9,.2f}"
              .format(inv["number"], inv["issuedDate"], len(inv["entryIds"]),
                      inv["snapshot"]["total"]))

    total_hours = sum(e["seconds"] for e in state["entries"]) / 3600
    unbilled = sum(line_amount(e["seconds"], e["rate"])
                   for e in state["entries"] if e["invoiceId"] is None)
    collected = sum(i["snapshot"]["total"] for i in invoices)
    print()
    print("{} entries, {:.1f}h total".format(len(state["entries"]), total_hours))
    print("  ${:>9,.2f} closed as paid ({:.1f}h)".format(collected, paid_seconds / 3600))
    print("  ${:>9,.2f} left unbilled".format(unbilled))

    if args.dry_run:
        print()
        print("(dry run -- nothing written)")
        return

    out_doc = {
        "app": "traction", "version": 1,
        "exportedAt": datetime.datetime.now().astimezone().isoformat(),
        "state": state,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out_doc, fh, indent=2)
    print()
    print("wrote " + args.out)


if __name__ == "__main__":
    main()
