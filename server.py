#!/usr/bin/env python3
"""
Group Travel Matcher - Backend Server
Pure Python BaseHTTPRequestHandler + SQLite3 State Persistence.
Zero external frameworks (no Flask, Django, or FastAPI).
"""

import sys
import os
import json
import sqlite3
import math
import re
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

# -----------------------------------------------------------------------------
# Configuration and Path Resolution
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "groupmatcher.db")
PORT = int(os.environ.get("PORT", 8000))

def resolve_data_path(rel_path):
    """
    Resolves data file path by checking:
    1. Direct relative path (e.g. data/problem-3/travellers.json)
    2. datasets/ relative path (e.g. datasets/data/problem-3/travellers.json)
    """
    candidates = [
        os.path.join(BASE_DIR, rel_path),
        os.path.join(BASE_DIR, "datasets", rel_path),
        os.path.join(os.getcwd(), rel_path),
        os.path.join(os.getcwd(), "datasets", rel_path)
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]

# -----------------------------------------------------------------------------
# Catalog & Mock Data Loader
# -----------------------------------------------------------------------------
CATALOG = {
    "travellers": [],
    "groups": [],
    "interests": [],
    "destinations": {},
    "hotels": [],
    "rooms": [],
    "availability": [],
    "hotels_by_id": {},
    "rooms_by_id": {},
    "rooms_by_hotel": {},
    "availability_map": {}  # (room_id, date_str) -> rooms_left
}

def load_static_datasets():
    print("[BOOTSTRAP] Loading catalog and problem-3 datasets...")
    # 1. Travellers
    t_path = resolve_data_path("data/problem-3/travellers.json")
    if os.path.exists(t_path):
        with open(t_path, "r", encoding="utf-8") as f:
            CATALOG["travellers"] = json.load(f)
    print(f"Loaded {len(CATALOG['travellers'])} initial travellers from {t_path}")

    # 2. Groups
    g_path = resolve_data_path("data/problem-3/groups.json")
    if os.path.exists(g_path):
        with open(g_path, "r", encoding="utf-8") as f:
            CATALOG["groups"] = json.load(f)
    print(f"Loaded {len(CATALOG['groups'])} initial groups from {g_path}")

    # 3. Interests
    i_path = resolve_data_path("data/problem-3/interests.json")
    if os.path.exists(i_path):
        with open(i_path, "r", encoding="utf-8") as f:
            CATALOG["interests"] = json.load(f)
    print(f"Loaded {len(CATALOG['interests'])} interest tags")

    # 4. Destinations
    d_path = resolve_data_path("data/catalog/destinations.json")
    if os.path.exists(d_path):
        with open(d_path, "r", encoding="utf-8") as f:
            CATALOG["destinations"] = json.load(f)
    print(f"Loaded destinations catalog")

    # 5. Hotels
    h_path = resolve_data_path("data/catalog/hotels.json")
    if os.path.exists(h_path):
        with open(h_path, "r", encoding="utf-8") as f:
            CATALOG["hotels"] = json.load(f)
        for h in CATALOG["hotels"]:
            CATALOG["hotels_by_id"][h["hotel_id"]] = h
    print(f"Loaded {len(CATALOG['hotels'])} hotels")

    # 6. Rooms
    r_path = resolve_data_path("data/catalog/rooms.json")
    if os.path.exists(r_path):
        with open(r_path, "r", encoding="utf-8") as f:
            CATALOG["rooms"] = json.load(f)
        for r in CATALOG["rooms"]:
            CATALOG["rooms_by_id"][r["room_id"]] = r
            hid = r["hotel_id"]
            if hid not in CATALOG["rooms_by_hotel"]:
                CATALOG["rooms_by_hotel"][hid] = []
            CATALOG["rooms_by_hotel"][hid].append(r)
    print(f"Loaded {len(CATALOG['rooms'])} room types")

    # 7. Availability
    a_path = resolve_data_path("data/catalog/availability.json")
    if os.path.exists(a_path):
        with open(a_path, "r", encoding="utf-8") as f:
            CATALOG["availability"] = json.load(f)
        for a in CATALOG["availability"]:
            key = (a["room_id"], a["date"])
            CATALOG["availability_map"][key] = a["rooms_left"]
    print(f"Loaded {len(CATALOG['availability'])} availability records")

# -----------------------------------------------------------------------------
# SQLite Database Setup & Migrations
# -----------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    print(f"[DB] Initializing database at {DB_FILE}...")
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS travellers (
            traveller_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER NOT NULL,
            gender TEXT NOT NULL,
            home_city TEXT NOT NULL,
            home_airport TEXT,
            interests TEXT NOT NULL,
            gender_preference TEXT NOT NULL,
            is_custom INTEGER DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS groups (
            group_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            member_ids TEXT NOT NULL,
            city TEXT NOT NULL,
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            max_size INTEGER NOT NULL,
            budget_inr INTEGER NOT NULL,
            itinerary TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS join_requests (
            request_id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            seeker_id TEXT NOT NULL,
            status TEXT NOT NULL, -- PENDING, APPROVED, REJECTED
            message TEXT,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS hotel_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            traveller_id TEXT NOT NULL,
            vote INTEGER NOT NULL, -- 1 for upvote, -1 for downvote
            updated_at TEXT NOT NULL,
            UNIQUE(group_id, room_id, traveller_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS group_bookings (
            booking_id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            hotel_id TEXT NOT NULL,
            hotel_name TEXT NOT NULL,
            room_id TEXT NOT NULL,
            room_name TEXT NOT NULL,
            rooms_count INTEGER NOT NULL,
            nights_count INTEGER NOT NULL,
            total_cost INTEGER NOT NULL,
            per_member_cost INTEGER NOT NULL,
            booked_by TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()

    # Pre-seed travellers if empty
    cur.execute("SELECT COUNT(*) FROM travellers")
    if cur.fetchone()[0] == 0:
        print("[DB] Seeding travellers from mock data...")
        for t in CATALOG["travellers"]:
            cur.execute("""
                INSERT INTO travellers (traveller_id, name, age, gender, home_city, home_airport, interests, gender_preference, is_custom)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (
                t["traveller_id"],
                t["name"],
                t.get("age", 25),
                t["gender"],
                t.get("home_city", ""),
                t.get("home_airport", ""),
                json.dumps(t.get("interests", [])),
                t.get("gender_preference", "ANY")
            ))
        conn.commit()

    # Pre-seed groups if empty
    cur.execute("SELECT COUNT(*) FROM groups")
    if cur.fetchone()[0] == 0:
        print("[DB] Seeding groups from mock data...")
        now_str = datetime.datetime.now().isoformat()
        for g in CATALOG["groups"]:
            cur.execute("""
                INSERT INTO groups (group_id, name, owner_id, member_ids, city, check_in, check_out, max_size, budget_inr, itinerary, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                g["group_id"],
                g["name"],
                g["owner_id"],
                json.dumps(g.get("member_ids", [g["owner_id"]])),
                g["city"],
                g["check_in"],
                g["check_out"],
                g["max_size"],
                g["budget_inr"],
                g.get("itinerary", ""),
                now_str
            ))
        conn.commit()

    conn.close()
    print("[DB] Initialization complete.")

# -----------------------------------------------------------------------------
# Core Business Logic & The 6 Matching Rules
# -----------------------------------------------------------------------------
VALID_CITIES = {"Tokyo", "Kyoto", "Osaka", "Dubai", "Abu Dhabi"}
WINDOW_START = datetime.date(2027, 4, 1)
WINDOW_END = datetime.date(2027, 4, 20)

# Simulated date support for auto-decline testing and live demonstration
SIMULATED_CURRENT_DATE = None

def parse_date(date_str):
    try:
        return datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return None

def get_current_date():
    global SIMULATED_CURRENT_DATE
    if SIMULATED_CURRENT_DATE:
        return SIMULATED_CURRENT_DATE
    env_date = os.environ.get("CURRENT_DATE")
    if env_date:
        parsed = parse_date(env_date)
        if parsed:
            return parsed
    return datetime.date.today()

def set_simulated_current_date(dt):
    global SIMULATED_CURRENT_DATE
    SIMULATED_CURRENT_DATE = dt

def auto_decline_expiring_requests(conn=None, group_id=None):
    """
    FEATURE 4: Time-based auto-rejection for pending join requests.
    Checks group check_in date against the current date.
    If trip is exactly 5 days away or less (days_until <= 5), automatically
    updates status in SQLite database from 'PENDING' to 'REJECTED'.
    """
    close_conn = False
    if conn is None:
        conn = get_db()
        close_conn = True

    current_date = get_current_date()
    cur = conn.cursor()

    query = """
        SELECT jr.request_id, jr.group_id, g.check_in, jr.seeker_id, jr.status, jr.message
        FROM join_requests jr
        JOIN groups g ON jr.group_id = g.group_id
        WHERE jr.status = 'PENDING'
    """
    params = ()
    if group_id:
        query += " AND jr.group_id = ?"
        params = (group_id,)

    cur.execute(query, params)
    rows = cur.fetchall()
    updated = []

    for r in rows:
        req_id = r["request_id"]
        ci_date = parse_date(r["check_in"])
        if ci_date:
            days_until = (ci_date - current_date).days
            if days_until <= 5:
                if days_until < 0:
                    decline_msg = "Request automatically declined (trip has already departed)"
                elif days_until == 0:
                    decline_msg = "Request automatically declined (trip departs today)"
                elif days_until == 1:
                    decline_msg = "Request automatically declined (trip departs in 1 day)"
                else:
                    decline_msg = f"Request automatically declined (trip departs in {days_until} days)"

                cur.execute("""
                    UPDATE join_requests
                    SET status = 'REJECTED', message = ?
                    WHERE request_id = ?
                """, (decline_msg, req_id))
                updated.append({
                    "request_id": req_id,
                    "group_id": r["group_id"],
                    "seeker_id": r["seeker_id"],
                    "days_until": days_until,
                    "message": decline_msg
                })

    if updated:
        conn.commit()

    if close_conn:
        conn.close()

    return updated

def evaluate_seeker_match(seeker, group, owner):
    """
    Evaluates the exact 6 matching rules with dynamic sliding-scale scores:
    1. Exact destination match (100% or 0%)
    2. Dates overlap by at least 2 nights (Sliding-scale: Green >= 95%, Yellow >= 50%, Red < 50%)
    3. Budget difference <= 40% of lower budget (Sliding-scale: Green >= 95%, Yellow >= 50%, Red < 50%)
    4. At least 2 shared interests with group owner (Sliding-scale)
    5. Mutual gender preferences match (100% or 0%)
    6. Adding seeker does not exceed group max_size
    """
    reasons = {}

    # Rule 1: Exact destination match
    seeker_city = seeker.get("city", "").strip()
    group_city = group.get("city", "").strip()
    rule1_pass = (seeker_city.lower() == group_city.lower())
    reasons["destination"] = {
        "pass": rule1_pass,
        "score_pct": 100.0 if rule1_pass else 0.0,
        "marker": "✓" if rule1_pass else "✗",
        "status": "EXCELLENT" if rule1_pass else "POOR",
        "color": "green" if rule1_pass else "red",
        "detail": f"Exact match on {group_city}" if rule1_pass else f"Destination mismatch: {seeker_city} vs {group_city}"
    }

    # Rule 2: Dates overlap >= 2 nights (Sliding-scale calculation)
    s_ci = parse_date(seeker.get("check_in", ""))
    s_co = parse_date(seeker.get("check_out", ""))
    g_ci = parse_date(group.get("check_in", ""))
    g_co = parse_date(group.get("check_out", ""))

    rule2_pass = False
    shared_nights = 0
    overlap_str = "None"
    seeker_nights = (s_co - s_ci).days if (s_ci and s_co) else 0

    if s_ci and s_co and g_ci and g_co:
        overlap_start = max(s_ci, g_ci)
        overlap_end = min(s_co, g_co)
        if overlap_end > overlap_start:
            shared_nights = (overlap_end - overlap_start).days
            overlap_str = f"{overlap_start.strftime('%d %b')} – {overlap_end.strftime('%d %b %Y')}"
        rule2_pass = (shared_nights >= 2)

    # Date overlap sliding-scale percentage score
    if seeker_nights > 0:
        date_score_pct = round((shared_nights / seeker_nights) * 100, 1)
    else:
        date_score_pct = 0.0

    if not rule2_pass:
        date_marker = "✗"
        date_status = "POOR"
        date_color = "red"
        date_detail = f"Only {shared_nights} shared nights ({date_score_pct}% overlap) – minimum 2 required"
    elif date_score_pct >= 95.0:
        date_marker = "✓"
        date_status = "EXCELLENT"
        date_color = "green"
        date_detail = f"{shared_nights} of {seeker_nights} nights shared ({date_score_pct}% overlap, {overlap_str}) – full trip alignment"
    elif date_score_pct >= 50.0:
        date_marker = "⚠"
        date_status = "WARNING"
        date_color = "yellow"
        date_detail = f"{shared_nights} of {seeker_nights} nights shared ({date_score_pct}% overlap, {overlap_str}) – partial overlap drags score"
    else:
        date_marker = "✗"
        date_status = "POOR"
        date_color = "red"
        date_detail = f"Only {shared_nights} of {seeker_nights} nights shared ({date_score_pct}% overlap) – significantly drags match score down"

    reasons["dates"] = {
        "pass": rule2_pass,
        "shared_nights": shared_nights,
        "seeker_nights": seeker_nights,
        "score_pct": date_score_pct,
        "marker": date_marker,
        "status": date_status,
        "color": date_color,
        "overlap_window": overlap_str,
        "detail": date_detail
    }

    # Rule 3: Budget difference <= 40% of lower budget (Sliding-scale calculation)
    try:
        s_budget = float(seeker.get("budget_inr", 0))
        g_budget = float(group.get("budget_inr", 0))
        lower_budget = min(s_budget, g_budget)
        budget_diff = abs(s_budget - g_budget)
        max_allowed_diff = 0.40 * lower_budget if lower_budget > 0 else 0
        rule3_pass = (lower_budget > 0 and budget_diff <= max_allowed_diff)
        diff_pct = round((budget_diff / lower_budget) * 100, 1) if lower_budget > 0 else 0
        # Closeness percentage to identical budgets (0% diff = 100%, 40% diff = 0%)
        budget_score_pct = round(max(0.0, (1.0 - (budget_diff / max_allowed_diff)) * 100), 1) if max_allowed_diff > 0 else 0.0
    except Exception:
        rule3_pass = False
        budget_diff = 0
        diff_pct = 0
        max_allowed_diff = 0
        lower_budget = 0
        budget_score_pct = 0.0

    if not rule3_pass:
        budget_marker = "✗"
        budget_status = "POOR"
        budget_color = "red"
        budget_detail = f"Diff ₹{int(budget_diff):,} ({diff_pct}%) exceeds 40% limit of lower budget (max allowed ₹{int(max_allowed_diff):,})"
    elif budget_score_pct >= 95.0:
        budget_marker = "✓"
        budget_status = "EXCELLENT"
        budget_color = "green"
        budget_detail = f"Diff ₹{int(budget_diff):,} ({diff_pct}%) – {budget_score_pct}% near-perfect budget match (max ₹{int(max_allowed_diff):,})"
    elif budget_score_pct >= 50.0:
        budget_marker = "⚠"
        budget_status = "WARNING"
        budget_color = "yellow"
        budget_detail = f"Diff ₹{int(budget_diff):,} ({diff_pct}%) – {budget_score_pct}% budget fit within 40% threshold (drags score)"
    else:
        budget_marker = "✗"
        budget_status = "POOR"
        budget_color = "red"
        budget_detail = f"Diff ₹{int(budget_diff):,} ({diff_pct}%) – only {budget_score_pct}% budget fit near 40% cap (drags score down)"

    reasons["budget"] = {
        "pass": rule3_pass,
        "diff_inr": int(budget_diff),
        "diff_pct": diff_pct,
        "score_pct": budget_score_pct,
        "marker": budget_marker,
        "status": budget_status,
        "color": budget_color,
        "seeker_budget": int(s_budget),
        "group_budget": int(g_budget),
        "max_allowed_diff": int(max_allowed_diff),
        "detail": budget_detail
    }

    # Rule 4: Shared interests >= 2
    s_interests = set(seeker.get("interests", []))
    o_interests = set(owner.get("interests", []))
    shared_interests = list(s_interests & o_interests)
    rule4_pass = (len(shared_interests) >= 2)

    if not rule4_pass:
        int_score_pct = round((len(shared_interests) / 2.0) * 50.0, 1)
        int_marker = "✗"
        int_status = "POOR"
        int_color = "red"
        int_detail = f"Only {len(shared_interests)} shared interest(s) with owner (at least 2 required)"
    elif len(shared_interests) >= 4:
        int_score_pct = 100.0
        int_marker = "✓"
        int_status = "EXCELLENT"
        int_color = "green"
        int_detail = f"{len(shared_interests)} shared interests: {', '.join(shared_interests)} (strong alignment)"
    elif len(shared_interests) == 3:
        int_score_pct = 80.0
        int_marker = "⚠"
        int_status = "WARNING"
        int_color = "yellow"
        int_detail = f"3 shared interests: {', '.join(shared_interests)}"
    else: # 2 shared interests
        int_score_pct = 60.0
        int_marker = "⚠"
        int_status = "WARNING"
        int_color = "yellow"
        int_detail = f"2 shared interests: {', '.join(shared_interests)} (minimum required)"

    reasons["interests"] = {
        "pass": rule4_pass,
        "shared_count": len(shared_interests),
        "shared_items": shared_interests,
        "score_pct": int_score_pct,
        "marker": int_marker,
        "status": int_status,
        "color": int_color,
        "detail": int_detail
    }

    # Rule 5: Mutual gender preferences match
    s_gender = seeker.get("gender", "").upper()
    s_pref = seeker.get("gender_preference", "ANY").upper()
    o_gender = owner.get("gender", "").upper()
    o_pref = owner.get("gender_preference", "ANY").upper()

    seeker_allows_owner = (s_pref == "ANY" or s_gender == o_gender)
    owner_allows_seeker = (o_pref == "ANY" or o_gender == s_gender)
    rule5_pass = bool(seeker_allows_owner and owner_allows_seeker)

    reasons["gender"] = {
        "pass": rule5_pass,
        "score_pct": 100.0 if rule5_pass else 0.0,
        "marker": "✓" if rule5_pass else "✗",
        "status": "EXCELLENT" if rule5_pass else "POOR",
        "color": "green" if rule5_pass else "red",
        "seeker_gender": s_gender,
        "seeker_pref": s_pref,
        "owner_gender": o_gender,
        "owner_pref": o_pref,
        "detail": "Mutual gender preferences satisfied" if rule5_pass else f"Gender mismatch: Seeker ({s_gender}, {s_pref}) vs Owner ({o_gender}, {o_pref})"
    }

    # Rule 6: Group size check
    current_members = group.get("member_ids", [])
    max_size = int(group.get("max_size", 4))
    rule6_pass = (len(current_members) + 1 <= max_size)
    spots_left = max_size - len(current_members)
    size_score_pct = 100.0 if spots_left >= 2 else (95.0 if rule6_pass else 0.0)

    reasons["group_size"] = {
        "pass": rule6_pass,
        "score_pct": size_score_pct,
        "marker": "✓" if rule6_pass else "✗",
        "status": "EXCELLENT" if rule6_pass else "POOR",
        "color": "green" if rule6_pass else "red",
        "current_members_count": len(current_members),
        "max_size": max_size,
        "spots_left": spots_left,
        "detail": f"{len(current_members)}/{max_size} members. 1 spot available for seeker." if rule6_pass else f"Group is full ({len(current_members)}/{max_size} members)."
    }

    is_match = all([rule1_pass, rule2_pass, rule3_pass, rule4_pass, rule5_pass, rule6_pass])

    # Calculate Overall Compatibility Score (0 - 100%)
    score = 0
    if is_match:
        int_score = min(40, len(shared_interests) * 15)
        b_ratio = 1.0 - (budget_diff / max_allowed_diff) if max_allowed_diff > 0 else 1.0
        bud_score = max(0, min(35, 35 * b_ratio))
        night_score = min(25, shared_nights * 5)
        score = int(round(int_score + bud_score + night_score))
        score = max(50, min(99, score))

    return {
        "is_match": is_match,
        "compatibility_score": score,
        "rules_breakdown": reasons
    }

# -----------------------------------------------------------------------------
# Common Group Page Hotel Search & Consensus Engine
# -----------------------------------------------------------------------------
def get_group_hotel_options(group_id):
    """
    Retrieves available hotel options for the group based on destination and stay dates.
    Calculates rooms needed, total cost, per-member cost, and consensus voting status.
    """
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
    grow = cur.fetchone()
    if not grow:
        conn.close()
        return None

    group = dict(grow)
    member_ids = json.loads(group["member_ids"])
    members_count = max(1, len(member_ids))

    city = group["city"]
    g_ci = parse_date(group["check_in"])
    g_co = parse_date(group["check_out"])

    if not g_ci or not g_co or g_co <= g_ci:
        conn.close()
        return []

    nights_count = (g_co - g_ci).days
    stay_dates = [(g_ci + datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(nights_count)]

    # Fetch existing votes for this group
    cur.execute("SELECT room_id, traveller_id, vote FROM hotel_votes WHERE group_id = ?", (group_id,))
    votes_rows = cur.fetchall()
    conn.close()

    votes_by_room = {}
    for vr in votes_rows:
        rid = vr["room_id"]
        if rid not in votes_by_room:
            votes_by_room[rid] = {"up": [], "down": []}
        if vr["vote"] == 1:
            votes_by_room[rid]["up"].append(vr["traveller_id"])
        elif vr["vote"] == -1:
            votes_by_room[rid]["down"].append(vr["traveller_id"])

    matching_hotels = [h for h in CATALOG["hotels"] if h.get("city", "").lower() == city.lower()]
    options = []

    for hotel in matching_hotels:
        hid = hotel["hotel_id"]
        hotel_rooms = CATALOG["rooms_by_hotel"].get(hid, [])
        for room in hotel_rooms:
            rid = room["room_id"]
            max_adults = max(1, room.get("max_adults", 2))
            rooms_needed = math.ceil(members_count / max_adults)

            # Check room availability across every night of the stay
            available = True
            min_free_rooms = 9999
            for d in stay_dates:
                free = CATALOG["availability_map"].get((rid, d), 0)
                if free < rooms_needed:
                    available = False
                    break
                if free < min_free_rooms:
                    min_free_rooms = free

            if not available:
                continue

            price_night = room.get("price_per_night", {}).get("amount", 0)
            total_cost = price_night * rooms_needed * nights_count
            per_member_cost = int(round(total_cost / members_count))

            room_votes = votes_by_room.get(rid, {"up": [], "down": []})
            upvoter_ids = room_votes["up"]
            downvoter_ids = room_votes["down"]

            # Consensus reached when ALL group members have upvoted this exact room
            has_consensus = (
                len(member_ids) > 0 and 
                all(m in upvoter_ids for m in member_ids)
            )

            # Consensus progress percentage
            consensus_pct = int(round((len(upvoter_ids) / len(member_ids)) * 100)) if member_ids else 0

            options.append({
                "hotel_id": hid,
                "hotel_name": hotel["name"],
                "area": hotel.get("area", ""),
                "rating": hotel.get("rating", 8.0),
                "stars": hotel.get("stars", 3),
                "image": hotel.get("image", "images/hotels/HOTEL-BUSINESS-1.jpg"),
                "check_in_from": hotel.get("check_in_from", "15:00"),
                "check_out_until": hotel.get("check_out_until", "11:00"),
                "room_id": rid,
                "room_type": room.get("room_type", "TWIN"),
                "room_name": room.get("name", "Standard Room"),
                "max_adults": max_adults,
                "refundable": room.get("refundable", False),
                "price_per_night": price_night,
                "rooms_needed": rooms_needed,
                "nights_count": nights_count,
                "total_cost": total_cost,
                "per_member_cost": per_member_cost,
                "min_free_rooms": min_free_rooms,
                "votes": {
                    "upvoter_ids": upvoter_ids,
                    "downvoter_ids": downvoter_ids,
                    "up_count": len(upvoter_ids),
                    "down_count": len(downvoter_ids),
                    "consensus_pct": consensus_pct,
                    "has_consensus": has_consensus
                }
            })

    # Sort options: consensus options first, then highest rating, then lowest per-person cost
    options.sort(key=lambda x: (not x["votes"]["has_consensus"], -x["rating"], x["per_member_cost"]))
    return options

# -----------------------------------------------------------------------------
# REST Request Handler
# -----------------------------------------------------------------------------
class GroupMatcherHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to keep terminal clean while logging errors
        if " 4" in format % args or " 5" in format % args:
            sys.stderr.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {format % args}\n")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, status_code, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status_code, message):
        self.send_json(status_code, {"error": message})

    def parse_json_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return {}
            data = self.rfile.read(content_length).decode("utf-8")
            return json.loads(data)
        except Exception as e:
            return None

    # -------------------------------------------------------------------------
    # Static File Delivery
    # -------------------------------------------------------------------------
    def serve_static(self, filepath, content_type):
        real_path = resolve_data_path(filepath)
        if not os.path.isfile(real_path):
            self.send_error_json(404, f"File not found: {filepath}")
            return

        try:
            with open(real_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(500, f"Error reading file: {str(e)}")

    # -------------------------------------------------------------------------
    # Route Dispatcher
    # -------------------------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API Endpoints
        if path == "/api/bootstrap":
            self.handle_bootstrap()
        elif path == "/api/destinations":
            self.send_json(200, CATALOG["destinations"])
        elif path == "/api/interests":
            self.send_json(200, CATALOG["interests"])
        elif path == "/api/travellers":
            self.handle_get_travellers(query)
        elif path == "/api/groups":
            self.handle_get_groups(query)
        elif path == "/api/system/date":
            self.send_json(200, {
                "current_date": str(get_current_date()),
                "is_simulated": SIMULATED_CURRENT_DATE is not None
            })
        elif re.match(r"^/api/travellers/([^/]+)/requests$", path):
            traveller_id = re.match(r"^/api/travellers/([^/]+)/requests$", path).group(1)
            self.handle_get_seeker_requests(traveller_id)
        elif re.match(r"^/api/groups/([^/]+)/hotels$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/hotels$", path).group(1)
            self.handle_get_group_hotels(group_id)
        elif re.match(r"^/api/groups/([^/]+)/requests$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/requests$", path).group(1)
            self.handle_get_group_requests(group_id)
        elif re.match(r"^/api/groups/([^/]+)/chat$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/chat$", path).group(1)
            self.handle_get_group_chat(group_id)
        elif re.match(r"^/api/groups/([^/]+)$", path):
            group_id = re.match(r"^/api/groups/([^/]+)$", path).group(1)
            self.handle_get_group_detail(group_id)

        # 2. Static Assets
        elif path in ("/", "/index.html"):
            self.serve_static("index.html", "text/html; charset=utf-8")
        elif path == "/style.css":
            self.serve_static("style.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self.serve_static("app.js", "application/javascript; charset=utf-8")
        elif path.startswith("/images/hotels/"):
            rel_file = path.lstrip("/")
            self.serve_static(rel_file, "image/jpeg")
        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            # Fallback to static or 404
            clean_path = path.lstrip("/")
            resolved = resolve_data_path(clean_path)
            if os.path.isfile(resolved):
                mime = "text/plain"
                if clean_path.endswith(".html"): mime = "text/html"
                elif clean_path.endswith(".css"): mime = "text/css"
                elif clean_path.endswith(".js"): mime = "application/javascript"
                elif clean_path.endswith(".jpg") or clean_path.endswith(".jpeg"): mime = "image/jpeg"
                elif clean_path.endswith(".json"): mime = "application/json"
                self.serve_static(clean_path, mime)
            else:
                self.send_error_json(404, f"Route not found: {path}")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/travellers":
            self.handle_create_traveller()
        elif path == "/api/system/date":
            self.handle_set_system_date()
        elif path == "/api/groups":
            self.handle_create_group()
        elif path == "/api/match":
            self.handle_seeker_match()
        elif path == "/api/groups/join":
            self.handle_join_request()
        elif re.match(r"^/api/groups/([^/]+)/requests/decide$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/requests/decide$", path).group(1)
            self.handle_request_decision(group_id)
        elif re.match(r"^/api/groups/([^/]+)/vote$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/vote$", path).group(1)
            self.handle_hotel_vote(group_id)
        elif re.match(r"^/api/groups/([^/]+)/book$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/book$", path).group(1)
            self.handle_finalize_booking(group_id)
        elif re.match(r"^/api/groups/([^/]+)/chat$", path):
            group_id = re.match(r"^/api/groups/([^/]+)/chat$", path).group(1)
            self.handle_send_chat(group_id)
        else:
            self.send_error_json(404, f"Unknown POST route: {path}")

    # -------------------------------------------------------------------------
    # API Implementation Handlers
    # -------------------------------------------------------------------------
    def handle_bootstrap(self):
        """Returns metadata for frontend initial load."""
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM travellers ORDER BY traveller_id ASC")
        travellers = [dict(r) for r in cur.fetchall()]
        for t in travellers:
            t["interests"] = json.loads(t["interests"])
        conn.close()

        self.send_json(200, {
            "destinations": CATALOG["destinations"],
            "interests": CATALOG["interests"],
            "travellers": travellers,
            "cities": list(VALID_CITIES)
        })

    def handle_get_travellers(self, query):
        conn = get_db()
        cur = conn.cursor()
        tid = query.get("id", [None])[0]
        if tid:
            cur.execute("SELECT * FROM travellers WHERE traveller_id = ?", (tid,))
            row = cur.fetchone()
            conn.close()
            if not row:
                self.send_error_json(404, "Traveller not found")
                return
            t = dict(row)
            t["interests"] = json.loads(t["interests"])
            self.send_json(200, t)
            return

        cur.execute("SELECT * FROM travellers ORDER BY traveller_id ASC")
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            d = dict(r)
            d["interests"] = json.loads(d["interests"])
            result.append(d)
        self.send_json(200, result)

    def handle_create_traveller(self):
        """M1: Sign Up / Profile Creation."""
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid JSON body")
            return

        name = body.get("name", "").strip()
        gender = body.get("gender", "").strip().upper()
        home_city = body.get("home_city", "").strip()
        home_airport = body.get("home_airport", "").strip().upper()
        interests = body.get("interests", [])
        gender_pref = body.get("gender_preference", "ANY").strip().upper()
        age = int(body.get("age", 25))

        if not name or gender not in ("FEMALE", "MALE"):
            self.send_error_json(400, "Name and valid gender (FEMALE or MALE) are required")
            return

        if gender_pref not in ("ANY", "SAME_GENDER"):
            gender_pref = "ANY"

        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM travellers")
        count = cur.fetchone()[0]
        traveller_id = f"T-U{count + 1:03d}"

        cur.execute("""
            INSERT INTO travellers (traveller_id, name, age, gender, home_city, home_airport, interests, gender_preference, is_custom)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (traveller_id, name, age, gender, home_city, home_airport, json.dumps(interests), gender_pref))
        conn.commit()

        cur.execute("SELECT * FROM travellers WHERE traveller_id = ?", (traveller_id,))
        new_traveller = dict(cur.fetchone())
        new_traveller["interests"] = json.loads(new_traveller["interests"])
        conn.close()

        self.send_json(201, new_traveller)

    def handle_get_groups(self, query):
        conn = get_db()
        cur = conn.cursor()
        city = query.get("city", [None])[0]

        if city:
            cur.execute("SELECT * FROM groups WHERE LOWER(city) = LOWER(?) ORDER BY check_in ASC", (city,))
        else:
            cur.execute("SELECT * FROM groups ORDER BY check_in ASC")
        rows = cur.fetchall()

        # Load all owners for display enrichment
        cur.execute("SELECT traveller_id, name, gender, home_city, interests, gender_preference FROM travellers")
        owners_map = {}
        for r in cur.fetchall():
            d = dict(r)
            d["interests"] = json.loads(d["interests"])
            owners_map[d["traveller_id"]] = d

        groups = []
        for r in rows:
            g = dict(r)
            g["member_ids"] = json.loads(g["member_ids"])
            g["owner"] = owners_map.get(g["owner_id"], {})
            groups.append(g)

        conn.close()
        self.send_json(200, groups)

    def handle_create_group(self):
        """M2: Group Owner Creates a Post."""
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid JSON payload")
            return

        name = body.get("name", "").strip()
        owner_id = body.get("owner_id", "").strip()
        city = body.get("city", "").strip()
        check_in = body.get("check_in", "").strip()
        check_out = body.get("check_out", "").strip()
        max_size = int(body.get("max_size", 3))
        budget_inr = int(body.get("budget_inr", 60000))
        itinerary = body.get("itinerary", "").strip()

        # Validations
        if not name or not owner_id or not city:
            self.send_error_json(400, "Name, owner_id, and destination city are required.")
            return

        if city not in VALID_CITIES:
            self.send_error_json(400, f"Destination '{city}' is not supported. Must be one of: {', '.join(sorted(VALID_CITIES))}")
            return

        d_ci = parse_date(check_in)
        d_co = parse_date(check_out)
        if not d_ci or not d_co:
            self.send_error_json(400, "Invalid dates. Expected YYYY-MM-DD.")
            return

        if d_ci < WINDOW_START or d_co > WINDOW_END or d_co <= d_ci:
            self.send_error_json(400, f"Dates must be between {WINDOW_START} and {WINDOW_END}, and check-out must follow check-in.")
            return

        if max_size < 1 or max_size > 4:
            self.send_error_json(400, "Group size must be between 1 and 4.")
            return

        conn = get_db()
        cur = conn.cursor()

        # Check owner exists
        cur.execute("SELECT * FROM travellers WHERE traveller_id = ?", (owner_id,))
        owner_row = cur.fetchone()
        if not owner_row:
            conn.close()
            self.send_error_json(400, f"Owner ID {owner_id} not found.")
            return

        cur.execute("SELECT COUNT(*) FROM groups")
        count = cur.fetchone()[0]
        group_id = f"G-{count + 1:02d}"
        now_str = datetime.datetime.now().isoformat()
        initial_members = [owner_id]

        cur.execute("""
            INSERT INTO groups (group_id, name, owner_id, member_ids, city, check_in, check_out, max_size, budget_inr, itinerary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (group_id, name, owner_id, json.dumps(initial_members), city, check_in, check_out, max_size, budget_inr, itinerary, now_str))
        conn.commit()

        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        created = dict(cur.fetchone())
        created["member_ids"] = json.loads(created["member_ids"])
        owner_dict = dict(owner_row)
        owner_dict["interests"] = json.loads(owner_dict["interests"])
        created["owner"] = owner_dict

        conn.close()
        self.send_json(201, created)

    def handle_seeker_match(self):
        """
        M3 & M4: Traveller Search & Match Evaluation.
        Executes the exact 6 matching rules on all groups in the database.
        """
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid search criteria")
            return

        city = body.get("city", "").strip()
        check_in = body.get("check_in", "").strip()
        check_out = body.get("check_out", "").strip()
        budget_inr = body.get("budget_inr", 0)
        interests = body.get("interests", [])
        gender = body.get("gender", "").upper()
        gender_pref = body.get("gender_preference", "ANY").upper()
        seeker_id = body.get("seeker_id")

        # Validate basic constraints
        if city not in VALID_CITIES:
            self.send_json(200, {
                "matches": [],
                "total_evaluated": 0,
                "message": f"City '{city}' is outside the valid catalog. Please select one of: {', '.join(sorted(VALID_CITIES))}."
            })
            return

        d_ci = parse_date(check_in)
        d_co = parse_date(check_out)
        if not d_ci or not d_co or d_ci < WINDOW_START or d_co > WINDOW_END or d_co <= d_ci:
            self.send_json(200, {
                "matches": [],
                "total_evaluated": 0,
                "message": f"Dates must fall within the catalog window (1 to 20 April 2027)."
            })
            return

        seeker = {
            "city": city,
            "check_in": check_in,
            "check_out": check_out,
            "budget_inr": budget_inr,
            "interests": interests,
            "gender": gender,
            "gender_preference": gender_pref
        }

        conn = get_db()
        cur = conn.cursor()

        # Feature 4: Auto-decline any expiring pending requests
        auto_decline_expiring_requests(conn)

        # Pre-fetch existing join requests for this seeker
        seeker_requests_map = {}
        if seeker_id:
            cur.execute("SELECT group_id, status, message FROM join_requests WHERE seeker_id = ?", (seeker_id,))
            for sr in cur.fetchall():
                seeker_requests_map[sr["group_id"]] = {
                    "status": sr["status"],
                    "message": sr["message"]
                }

        cur.execute("SELECT * FROM groups")
        group_rows = cur.fetchall()

        cur.execute("SELECT * FROM travellers")
        travellers_map = {}
        for tr in cur.fetchall():
            td = dict(tr)
            td["interests"] = json.loads(td["interests"])
            travellers_map[td["traveller_id"]] = td

        matches = []
        all_evaluated = []

        for gr in group_rows:
            group = dict(gr)
            group["member_ids"] = json.loads(group["member_ids"])
            owner = travellers_map.get(group["owner_id"], {})

            # Skip groups the seeker already belongs to
            if seeker_id and seeker_id in group["member_ids"]:
                continue

            evaluation = evaluate_seeker_match(seeker, group, owner)
            group["owner"] = owner
            group["match_info"] = evaluation
            group["seeker_request"] = seeker_requests_map.get(group["group_id"])

            # Enrich members for profile view
            members_detail = [travellers_map.get(mid) for mid in group["member_ids"] if mid in travellers_map]
            group["members_detail"] = members_detail

            all_evaluated.append(group)
            if evaluation["is_match"]:
                matches.append(group)

        conn.close()

        # Sort matches by compatibility score DESC, then date overlap shared nights DESC
        matches.sort(
            key=lambda x: (
                -x["match_info"]["compatibility_score"],
                -x["match_info"]["rules_breakdown"]["dates"]["shared_nights"],
                x["check_in"]
            )
        )

        self.send_json(200, {
            "matches": matches,
            "total_matches": len(matches),
            "total_evaluated": len(all_evaluated),
            "all_evaluated": all_evaluated  # available for diagnostics/inspect
        })

    def handle_join_request(self):
        """M5 & FEATURE 4: Seeker expresses interest in a group with auto-decline check."""
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid payload")
            return

        group_id = body.get("group_id")
        seeker_id = body.get("seeker_id")
        message = body.get("message", "I'd love to join your travel group!")

        if not group_id or not seeker_id:
            self.send_error_json(400, "group_id and seeker_id are required")
            return

        conn = get_db()
        cur = conn.cursor()

        # Check group exists and has capacity
        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        grow = cur.fetchone()
        if not grow:
            conn.close()
            self.send_error_json(404, "Group not found")
            return

        group = dict(grow)
        members = json.loads(group["member_ids"])
        if seeker_id in members:
            conn.close()
            self.send_json(200, {"status": "ALREADY_MEMBER", "message": "You are already a member of this group."})
            return

        if len(members) >= group["max_size"]:
            conn.close()
            self.send_error_json(400, "Group has already reached maximum capacity.")
            return

        # Check existing request
        cur.execute("SELECT * FROM join_requests WHERE group_id = ? AND seeker_id = ?", (group_id, seeker_id))
        existing = cur.fetchone()
        if existing:
            conn.close()
            self.send_json(200, {"status": existing["status"], "message": f"Request already submitted (Status: {existing['status']})."})
            return

        # FEATURE 4: Check if trip departs in 5 days or less from current date
        ci_date = parse_date(group.get("check_in", ""))
        current_date = get_current_date()
        if ci_date:
            days_until = (ci_date - current_date).days
            if days_until <= 5:
                if days_until < 0:
                    decline_msg = "Request automatically declined (trip has already departed)"
                elif days_until == 0:
                    decline_msg = "Request automatically declined (trip departs today)"
                elif days_until == 1:
                    decline_msg = "Request automatically declined (trip departs in 1 day)"
                else:
                    decline_msg = f"Request automatically declined (trip departs in {days_until} days)"

                request_id = f"REQ-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(2).hex()}"
                now_str = datetime.datetime.now().isoformat()
                cur.execute("""
                    INSERT INTO join_requests (request_id, group_id, seeker_id, status, message, created_at)
                    VALUES (?, ?, ?, 'REJECTED', ?, ?)
                """, (request_id, group_id, seeker_id, decline_msg, now_str))
                conn.commit()
                conn.close()

                self.send_json(200, {
                    "request_id": request_id,
                    "status": "REJECTED",
                    "auto_declined": True,
                    "message": decline_msg
                })
                return

        request_id = f"REQ-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(2).hex()}"
        now_str = datetime.datetime.now().isoformat()

        cur.execute("""
            INSERT INTO join_requests (request_id, group_id, seeker_id, status, message, created_at)
            VALUES (?, ?, ?, 'PENDING', ?, ?)
        """, (request_id, group_id, seeker_id, message, now_str))
        conn.commit()
        conn.close()

        self.send_json(201, {
            "request_id": request_id,
            "status": "PENDING",
            "message": "Interest expressed successfully! Waiting for group creator approval."
        })

    def handle_get_group_requests(self, group_id):
        conn = get_db()
        # FEATURE 4: Auto-decline expiring pending requests
        auto_decline_expiring_requests(conn, group_id)
        cur = conn.cursor()
        cur.execute("""
            SELECT jr.*, t.name as seeker_name, t.gender as seeker_gender, t.home_city as seeker_home_city, t.interests as seeker_interests
            FROM join_requests jr
            JOIN travellers t ON jr.seeker_id = t.traveller_id
            WHERE jr.group_id = ?
            ORDER BY jr.created_at DESC
        """, (group_id,))
        rows = cur.fetchall()
        conn.close()

        requests = []
        for r in rows:
            d = dict(r)
            d["seeker_interests"] = json.loads(d["seeker_interests"])
            requests.append(d)
        self.send_json(200, requests)

    def handle_get_seeker_requests(self, traveller_id):
        conn = get_db()
        auto_decline_expiring_requests(conn)
        cur = conn.cursor()
        cur.execute("""
            SELECT jr.*, g.name as group_name, g.city as group_city, g.check_in, g.check_out
            FROM join_requests jr
            JOIN groups g ON jr.group_id = g.group_id
            WHERE jr.seeker_id = ?
            ORDER BY jr.created_at DESC
        """, (traveller_id,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        self.send_json(200, rows)

    def handle_set_system_date(self):
        body = self.parse_json_body() or {}
        date_str = body.get("current_date")
        if date_str:
            dt = parse_date(date_str)
            if not dt:
                self.send_error_json(400, "Invalid date format. Expected YYYY-MM-DD.")
                return
            set_simulated_current_date(dt)
        else:
            set_simulated_current_date(None)

        conn = get_db()
        declined = auto_decline_expiring_requests(conn)
        conn.close()

        self.send_json(200, {
            "current_date": str(get_current_date()),
            "is_simulated": SIMULATED_CURRENT_DATE is not None,
            "auto_declined_count": len(declined),
            "auto_declined_items": declined,
            "message": f"System date set to {get_current_date()}. Auto-declined {len(declined)} expiring request(s)."
        })

    def handle_request_decision(self, group_id):
        """M5: Group creator accepts or declines a seeker's request."""
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid payload")
            return

        request_id = body.get("request_id")
        action = body.get("action", "").upper()  # APPROVE or REJECT

        if action not in ("APPROVE", "REJECT"):
            self.send_error_json(400, "Action must be APPROVE or REJECT")
            return

        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT * FROM join_requests WHERE request_id = ? AND group_id = ?", (request_id, group_id))
        req = cur.fetchone()
        if not req:
            conn.close()
            self.send_error_json(404, "Join request not found")
            return

        seeker_id = req["seeker_id"]
        new_status = "APPROVED" if action == "APPROVE" else "REJECTED"

        if action == "APPROVE":
            cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
            group = dict(cur.fetchone())
            members = json.loads(group["member_ids"])

            if len(members) >= group["max_size"]:
                conn.close()
                self.send_error_json(400, "Cannot approve: group has already reached maximum capacity.")
                return

            if seeker_id not in members:
                members.append(seeker_id)
                cur.execute("UPDATE groups SET member_ids = ? WHERE group_id = ?", (json.dumps(members), group_id))

        cur.execute("UPDATE join_requests SET status = ? WHERE request_id = ?", (new_status, request_id))
        conn.commit()

        # Fetch updated group
        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        updated_group = dict(cur.fetchone())
        updated_group["member_ids"] = json.loads(updated_group["member_ids"])
        conn.close()

        self.send_json(200, {
            "status": new_status,
            "group": updated_group,
            "message": f"Request {new_status.lower()}ed successfully."
        })

    def handle_get_group_detail(self, group_id):
        """M6: Retrieves group detail, member profiles, and booking status."""
        conn = get_db()
        # FEATURE 4: Auto-decline expiring pending requests
        auto_decline_expiring_requests(conn, group_id)
        cur = conn.cursor()

        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        grow = cur.fetchone()
        if not grow:
            conn.close()
            self.send_error_json(404, "Group not found")
            return

        group = dict(grow)
        member_ids = json.loads(group["member_ids"])
        group["member_ids"] = member_ids

        # Fetch member profiles
        placeholders = ",".join("?" for _ in member_ids)
        cur.execute(f"SELECT * FROM travellers WHERE traveller_id IN ({placeholders})", member_ids)
        members = []
        for m in cur.fetchall():
            md = dict(m)
            md["interests"] = json.loads(md["interests"])
            members.append(md)
        group["members"] = members

        # Check existing booking
        cur.execute("SELECT * FROM group_bookings WHERE group_id = ?", (group_id,))
        brow = cur.fetchone()
        group["booking"] = dict(brow) if brow else None

        # Fetch pending requests count
        cur.execute("SELECT COUNT(*) FROM join_requests WHERE group_id = ? AND status = 'PENDING'", (group_id,))
        group["pending_requests_count"] = cur.fetchone()[0]

        conn.close()
        self.send_json(200, group)

    def handle_get_group_hotels(self, group_id):
        """M6: Computes available hotel options and consensus progress."""
        options = get_group_hotel_options(group_id)
        if options is None:
            self.send_error_json(404, "Group not found")
            return
        self.send_json(200, options)

    def handle_hotel_vote(self, group_id=None):
        """
        WOW FACTOR: Tinder-style Hotel Voting System.
        Approved members vote up (+1) or down (-1) on hotel room options.
        """
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid voting payload")
            return

        group_id = group_id or body.get("group_id")
        room_id = body.get("room_id")
        traveller_id = body.get("traveller_id")
        vote = int(body.get("vote", 1))  # 1 (upvote), -1 (downvote)

        if not group_id or not room_id or not traveller_id:
            self.send_error_json(400, "group_id, room_id, and traveller_id are required")
            return

        conn = get_db()
        cur = conn.cursor()

        # Verify group & member
        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        grow = cur.fetchone()
        if not grow:
            conn.close()
            self.send_error_json(404, "Group not found")
            return

        members = json.loads(grow["member_ids"])
        if traveller_id not in members:
            conn.close()
            self.send_error_json(403, "Only approved group members can vote.")
            return

        now_str = datetime.datetime.now().isoformat()
        cur.execute("""
            INSERT INTO hotel_votes (group_id, room_id, traveller_id, vote, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(group_id, room_id, traveller_id) 
            DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at
        """, (group_id, room_id, traveller_id, vote, now_str))
        conn.commit()

        # Check if unanimous consensus is reached on this room
        cur.execute("SELECT traveller_id FROM hotel_votes WHERE group_id = ? AND room_id = ? AND vote = 1", (group_id, room_id))
        upvoters = [r[0] for r in cur.fetchall()]
        all_agreed = all(m in upvoters for m in members)

        conn.close()

        self.send_json(200, {
            "success": True,
            "room_id": room_id,
            "vote": vote,
            "upvoters_count": len(upvoters),
            "members_count": len(members),
            "unanimous_consensus": all_agreed,
            "message": "Vote recorded. 100% unanimous consensus unlocked!" if all_agreed else "Vote recorded."
        })

    def handle_finalize_booking(self, group_id):
        """
        M6 & WOW FACTOR: Finalizes group booking when consensus is reached.
        """
        body = self.parse_json_body() or {}
        room_id = body.get("room_id")
        booked_by = body.get("booked_by", "Group Consensus")

        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT * FROM groups WHERE group_id = ?", (group_id,))
        grow = cur.fetchone()
        if not grow:
            conn.close()
            self.send_error_json(404, "Group not found")
            return

        # Check existing booking
        cur.execute("SELECT * FROM group_bookings WHERE group_id = ?", (group_id,))
        existing = cur.fetchone()
        if existing:
            conn.close()
            self.send_json(200, {"success": True, "booking": dict(existing), "message": "Booking already confirmed."})
            return

        # Fetch room option details
        options = get_group_hotel_options(group_id)
        selected_option = next((opt for opt in options if opt["room_id"] == room_id), None)
        if not selected_option:
            conn.close()
            self.send_error_json(400, "Hotel room option not found or no longer available.")
            return

        # Generate unique booking ID
        city_code = selected_option["hotel_id"].split("-")[1] if "-" in selected_option["hotel_id"] else "TRIP"
        booking_id = f"BKG-{city_code}-2027-{os.urandom(3).hex().upper()}"
        now_str = datetime.datetime.now().isoformat()

        cur.execute("""
            INSERT INTO group_bookings (
                booking_id, group_id, hotel_id, hotel_name, room_id, room_name,
                rooms_count, nights_count, total_cost, per_member_cost, booked_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            booking_id, group_id, selected_option["hotel_id"], selected_option["hotel_name"],
            selected_option["room_id"], selected_option["room_name"], selected_option["rooms_needed"],
            selected_option["nights_count"], selected_option["total_cost"], selected_option["per_member_cost"],
            booked_by, now_str
        ))
        conn.commit()

        cur.execute("SELECT * FROM group_bookings WHERE booking_id = ?", (booking_id,))
        booking = dict(cur.fetchone())
        conn.close()

        self.send_json(201, {
            "success": True,
            "booking": booking,
            "message": f"Booking successfully confirmed! Reference #{booking_id}."
        })

    def handle_get_group_chat(self, group_id):
        """S1: Stretch Chat Feature."""
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT c.*, t.name as sender_name, t.gender as sender_gender
            FROM chat_messages c
            JOIN travellers t ON c.sender_id = t.traveller_id
            WHERE c.group_id = ?
            ORDER BY c.created_at ASC
        """, (group_id,))
        rows = cur.fetchall()
        conn.close()
        self.send_json(200, [dict(r) for r in rows])

    def handle_send_chat(self, group_id):
        """S1: Send a chat message."""
        body = self.parse_json_body()
        if not body:
            self.send_error_json(400, "Invalid payload")
            return

        sender_id = body.get("sender_id")
        message = body.get("message", "").strip()

        if not sender_id or not message:
            self.send_error_json(400, "sender_id and message are required")
            return

        conn = get_db()
        cur = conn.cursor()
        now_str = datetime.datetime.now().strftime("%I:%M %p")

        cur.execute("""
            INSERT INTO chat_messages (group_id, sender_id, message, created_at)
            VALUES (?, ?, ?, ?)
        """, (group_id, sender_id, message, now_str))
        conn.commit()

        msg_id = cur.lastrowid
        cur.execute("""
            SELECT c.*, t.name as sender_name, t.gender as sender_gender
            FROM chat_messages c
            JOIN travellers t ON c.sender_id = t.traveller_id
            WHERE c.id = ?
        """, (msg_id,))
        created = dict(cur.fetchone())
        conn.close()

        self.send_json(201, created)

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
def run_server():
    load_static_datasets()
    init_db()

    server_address = ("", PORT)
    httpd = HTTPServer(server_address, GroupMatcherHandler)
    print("=" * 65)
    print(f"🚀 GROUP TRAVEL MATCHER SERVER RUNNING")
    print(f"👉 Local URL: http://localhost:{PORT}")
    print(f"👉 Ready for judges' live tests & demonstrations.")
    print("=" * 65)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Server stopped gracefully.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
