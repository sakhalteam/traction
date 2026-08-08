#!/usr/bin/env python3
"""
One-shot Toggl -> traction migration (run 2026-08-08).

Reads Toggl's per-year "detailed report" CSVs and writes a traction backup file
that Settings -> "Restore backup..." can ingest. Kept in the repo because
restoring replaces ALL state, so redoing the migration is the only way back if
an import ever goes sideways.

Usage:
    python scripts/toggl-to-traction.py <toggl-export-dir> [-o out.json]

Why this exists rather than a hand-import: Toggl's client data was a mess.
  * The *workspace* export (clients/projects/tags JSON) has no time entries at
    all -- hours only come from the Reports > Detailed CSV, one year at a time.
  * In 2026 the `Client` column is empty on every row, because Toggl mobile
    can't create clients. Nic instead made projects named after clients
    ("GIES", "Cathy", "marlene") or just typed the name in the description.
    CLIENT_MAP_2026 below recovers identity from those two columns.
  * Pre-2026 rows *do* have `Client` filled in, so they map directly.
  * `#paid` was how Nic tracked payment. It becomes a closed `paid` invoice per
    client per year, which stamps invoiceId so those hours can never be
    double-billed.

Shapes mirror src/types.ts, and build_breakdown() is a faithful port of
buildBreakdown() in src/store.ts so frozen invoice snapshots match exactly what
the app would have computed itself.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import glob
import json
import os
import random
import string
from collections import defaultdict

# ---- Services --------------------------------------------------------------

GARDENING = "Gardening"
WASHING = "Pressure washing"
MOTION = "Motion design (archive)"

SERVICES = [
    # (name, default $/hr, color, archived)
    (GARDENING, 30, "#22c55e", False),
    (WASHING, 50, "#0ea5e9", False),
    # Freelance/agency era. Rate 0 on purpose: no rate data survives, and
    # ReportsView sums `unbilled` by rate with no archived filter, so a made-up
    # number here would corrupt the live gardening figures. Hours are kept,
    # money is not invented.
    (MOTION, 0, "#64748b", True),
]

# ---- 2026 identity recovery: (Project, Description) -> (client, service, rate)
CLIENT_MAP_2026 = {
    ("", "Stein"):                         ("Stein",              GARDENING, 30),
    ("GIES", "Larry Linda"):               ("Larry Gies",         GARDENING, 30),
    ("", "John house"):                    ("John",               GARDENING, 30),
    ("Cathy", "Cathy"):                    ("Cathy",              GARDENING, 30),
    ("", "Gallagher"):                     ("Gallagher",          GARDENING, 30),
    ("marlene", "Marlene"):                ("Marlene + Jeanette", WASHING,   50),
    ("", "MacArthur @pressure washing"):   ("MacArthur",          WASHING,   50),  # rate ASSUMED
    ("pressurewashing", "Diana"):          ("Diana",              WASHING,   50),  # rate ASSUMED
    ("pressurewashing", "Sylvia Gardner"): ("Sylvia Gardner",     WASHING,   50),  # rate ASSUMED
}

# ---- Pre-2026: Toggl `Client` column -> traction client --------------------
# Same person, two spellings: "John 19704" is the 2026 "John house".
CLIENT_RENAME = {"John 19704": "John"}

# Gardening clients keep their real rate; everything else is archived agency work.
LIVE_CLIENT_RATES = {"Stein": 30, "John": 30, "Gallagher": 30}

# Client -> date through which everything is settled, regardless of tagging.
# Nic tagged `#paid` by hand in Toggl and missed some, so the tag understates
# what was actually collected. Entries on or before this date are treated as
# paid even when untagged.
PAID_THROUGH = {
    "Larry Gies": "2026-07-14",
}

# Rows with no Client whose description unambiguously names a live client.
# Everything else in the no-client bucket (therapist, "Japanese lesson",
# "walking", "grocery store", "distracted") is personal time tracking -- dropped.
# "BF" (2.1h) is probably Stein's Back Forty but is too ambiguous to claim.
NO_CLIENT_RESCUE = [
    ("gallagher", "Gallagher", GARDENING, 30),
    ("stein", "Stein", GARDENING, 30),
]

_rng = random.Random(20260808)  # deterministic: same input -> same file


def gen_id() -> str:
    """Same shape as store.ts genId(): 8 base36 chars + a base36 timestamp."""
    return "".join(_rng.choice(string.ascii_lowercase + string.digits)
                   for _ in range(8)) + format(_rng.randrange(36 ** 8), "x")


def epoch_ms(date_str: str, time_str: str) -> int:
    """Local wall-clock -> epoch ms (naive .timestamp() uses the machine tz)."""
    return int(datetime.datetime.fromisoformat(f"{date_str}T{time_str}").timestamp() * 1000)


def line_amount(seconds: int, rate: float) -> float:
    """store.ts lineAmount()."""
    return round(seconds / 3600 * rate, 2)


def add_days(iso: str, days: int) -> str:
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=days)).isoformat()


def build_breakdown(entries: list[dict], service_names: dict[str, str]) -> dict:
    """Faithful port of store.ts buildBreakdown() so snapshots match the app."""
    by_date: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_date[e["date"]].append(e)

    days, total, total_seconds = [], 0.0, 0
    for date in sorted(by_date):
        by_line: dict[str, dict] = {}
        for e in by_date[date]:
            key = f'{e["serviceId"]}::{e["rate"]}'
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
        day_total = round(day_total, 2)
        days.append({"date": date, "lines": lines,
                     "daySeconds": day_seconds, "dayTotal": day_total})
        total += day_total
        total_seconds += day_seconds

    return {"days": days, "totalSeconds": total_seconds, "total": round(total, 2)}


def parse_duration(value: str) -> float:
    """Toggl writes decimal hours in some exports and HH:MM:SS in others."""
    try:
        return float(value)
    except ValueError:
        h, m, s = value.split(":")
        return int(h) + int(m) / 60 + int(s) / 3600


def read_rows(src_dir: str) -> list[dict]:
    rows = []
    for path in sorted(glob.glob(os.path.join(src_dir, "Toggl_time_entries_*.csv"))):
        with open(path, encoding="utf-8-sig", newline="") as fh:
            rows.extend(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"No Toggl_time_entries_*.csv found in {src_dir}")
    return rows


def classify(row: dict) -> tuple[str, str, float] | None:
    """Row -> (client, service, rate), or None to drop it."""
    client, project, desc = row["Client"].strip(), row["Project"].strip(), row["Description"].strip()

    if not client:
        # 2026 rows carry identity in Project/Description.
        hit = CLIENT_MAP_2026.get((project, desc))
        if hit:
            return hit
        # Pre-2026 strays: rescue only descriptions naming a live client.
        for needle, name, svc, rate in NO_CLIENT_RESCUE:
            if needle in desc.lower():
                return name, svc, rate
        return None

    name = CLIENT_RENAME.get(client, client)
    if name in LIVE_CLIENT_RATES:
        return name, GARDENING, LIVE_CLIENT_RATES[name]
    return name, MOTION, 0  # archived agency era


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", help="folder holding the Toggl_time_entries_*.csv files")
    ap.add_argument("-o", "--out", default="traction-import-from-toggl.json")
    args = ap.parse_args()

    rows = read_rows(args.src_dir)
    now_ms = int(datetime.datetime.now().timestamp() * 1000)

    # --- Services ---------------------------------------------------------
    services, service_id = [], {}
    for name, rate, color, archived in SERVICES:
        sid = gen_id()
        service_id[name] = sid
        services.append({"id": sid, "name": name, "defaultRate": rate, "color": color,
                         "archived": archived, "createdAt": now_ms})
    service_names = {v: k for k, v in service_id.items()}

    # --- Entries (clients created on first sighting) -----------------------
    clients, client_id, client_svc = [], {}, {}
    entries, dropped = [], []

    for r in rows:
        hit = classify(r)
        if hit is None:
            dropped.append((r["Description"], parse_duration(r["Duration"])))
            continue
        cname, svc, rate = hit

        if cname not in client_id:
            cid = gen_id()
            client_id[cname] = cid
            client_svc[cname] = svc
            clients.append({
                "id": cid, "name": cname, "email": "", "phone": "", "address": "", "notes": "",
                # Explicit override pins the known rate even if a service default moves.
                "rates": {service_id[svc]: rate},
                # Agency-era clients stay out of the timer/invoice/expense pickers.
                "archived": svc == MOTION,
                "createdAt": now_ms,
            })

        start = epoch_ms(r["Start date"], r["Start time"])
        end = epoch_ms(r["End date"], r["End time"])
        # Preserve Toggl's project/description as the entry note so the detail
        # ("Planting prep", "Deadhead Rhodies") survives the merge into 2 services.
        bits = [b for b in (r["Project"].strip(), r["Description"].strip()) if b]
        note = " — ".join(dict.fromkeys(bits)) if bits else ""
        if note in (cname, ""):
            note = ""

        entries.append({
            "id": gen_id(), "clientId": client_id[cname], "serviceId": service_id[svc],
            "note": note, "date": r["Start date"], "startedAt": start,
            "seconds": round((end - start) / 1000), "runningSince": None, "rate": rate,
            "invoiceId": None, "createdAt": start,
            # scratch, stripped before writing
            "_paid": ("paid" in (r["Tags"] or "").lower()
                      or not r["Start date"].startswith("2026")
                      or r["Start date"] <= PAID_THROUGH.get(cname, "")),
            "_svc": svc,
        })

    # --- Backfill invoices: one per client per year, for paid work ---------
    # Pre-2026 gardening is all paid (confirmed by Nic); 2026 uses the #paid tag.
    # Agency-era work is rate 0 and archived, so it gets no invoices at all.
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for e in entries:
        if e["_paid"] and e["_svc"] != MOTION:
            buckets[(e["clientId"], e["date"][:4])].append(e)

    name_of = {c["id"]: c["name"] for c in clients}
    invoices, counter = [], 1
    for (cid, year) in sorted(buckets, key=lambda k: (min(e["date"] for e in buckets[k]), name_of[k[0]])):
        ce = sorted(buckets[(cid, year)], key=lambda e: e["date"])
        inv_id = gen_id()
        for e in ce:
            e["invoiceId"] = inv_id
        period_start, period_end = ce[0]["date"], ce[-1]["date"]
        invoices.append({
            "id": inv_id, "clientId": cid, "number": f"{counter:04d}",
            "issuedDate": period_end, "dueDate": add_days(period_end, 30),
            "periodStart": period_start, "periodEnd": period_end,
            "entryIds": [e["id"] for e in ce],
            "snapshot": build_breakdown(ce, service_names),
            "expenseIds": [], "expensesSnapshot": [],
            "status": "paid", "paidDate": period_end,
            "notes": f"Backfilled from Toggl ({year}). Paid at time of service.",
            "createdAt": now_ms,
        })
        counter += 1

    for e in entries:
        del e["_paid"], e["_svc"]

    state = {
        "clients": clients, "services": services, "entries": entries,
        "expenses": [], "invoices": invoices,
        "settings": {"businessName": "", "businessEmail": "", "businessPhone": "",
                     "businessAddress": "", "invoiceCounter": counter,
                     "currency": "$", "netDays": 30},
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"app": "traction", "version": 1,
                   "exportedAt": datetime.datetime.now().astimezone().isoformat(),
                   "state": state}, fh, indent=2)

    # --- Report -----------------------------------------------------------
    print(f"wrote {args.out}\n")
    print(f"{len(rows)} Toggl rows -> {len(entries)} entries "
          f"({len(dropped)} dropped), {len(clients)} clients, {len(invoices)} paid invoices\n")
    print(f"{'CLIENT':<22}{'SERVICE':<24}{'HOURS':>8}{'PAID $':>11}{'OWED $':>10}")
    print("-" * 75)
    owed_total = paid_total = 0.0
    for c in sorted(clients, key=lambda c: (c["archived"], c["name"])):
        ce = [e for e in entries if e["clientId"] == c["id"]]
        hours = sum(e["seconds"] for e in ce) / 3600
        paid = sum(i["snapshot"]["total"] for i in invoices if i["clientId"] == c["id"])
        owed = round(sum(line_amount(e["seconds"], e["rate"])
                         for e in ce if e["invoiceId"] is None), 2)
        paid_total += paid
        owed_total += owed
        tag = " (archived)" if c["archived"] else ""
        print(f'{c["name"] + tag:<22}{service_names[ce[0]["serviceId"]]:<24}'
              f'{hours:>8.1f}{paid:>11.2f}{owed:>10.2f}')
    print("-" * 75)
    print(f'{"TOTAL":<22}{"":<24}{sum(e["seconds"] for e in entries) / 3600:>8.1f}'
          f'{paid_total:>11.2f}{owed_total:>10.2f}')
    print(f"\ndropped {round(sum(h for _, h in dropped), 1)}h of personal/ambiguous rows")


if __name__ == "__main__":
    main()
