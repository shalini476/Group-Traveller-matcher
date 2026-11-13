# Group Travel Matcher (Booking.com Intern Hackathon - Problem 3)

A production-ready, premium "Group Travel Matcher" web application designed for solo travellers looking to split costs, align travel dates, share authentic experiences, and book accommodations together.

Built with a **Pure Python backend** (`http.server.BaseHTTPRequestHandler` + `sqlite3`), **Semantic HTML5**, a **Single Modern CSS file (`style.css`)**, and **Vanilla JavaScript (ES6+ Fetch API)**. No external frameworks, no React/Vue, and no AI calls inside the app.

---

## ⚡ Quick Start (1 Command)

Open your terminal in the project directory and run:

```bash
python server.py
```

Then open your browser at:
👉 **[http://localhost:8000](http://localhost:8000)**

*(Works out-of-the-box on standard Python 3.8+ with zero pip dependencies).*

---

## 🌟 The "Wow Factor": Smart Consensus Booking Engine

Instead of simply displaying hotel options and dividing the cost, this application introduces an interactive **Tinder-style Hotel Voting & Offline Consensus Engine** directly on the **Common Group Page**:

1. **Member Voting Deck:** Each approved group member can vote **👍 (Love it!)** or **👎 (Pass)** on verified hotel room options for their destination and stay dates.
2. **Real-time Alignment Matrix:** The group sees live vote chips for every member (e.g. Sarah: 👍, Priya: ⏳) and a consensus progress bar.
3. **The Magic Locked/Unlocked CTA:** 
   - The final **"Finalize Group Booking"** CTA button remains **strictly locked and greyed out** while awaiting consensus.
   - The moment **all approved group members upvote the exact same hotel option**, the card lights up with an emerald green glow, a *"100% Consensus Reached"* badge appears, confetti bursts on screen, and the button unlocks and flashes green!
4. **Official Group Booking Confirmation:** Any member can click the unlocked button to confirm the booking for the entire group. A persistent digital voucher with an official Booking ID (e.g., `#BKG-KYO-2027-4821`), itemized stay summary, and equal per-member cost split is generated in SQLite.

---

## 🎯 The 6 Strict Matching Rules (Backend Implementation)

Implemented purely in Python inside `server.py`:

| # | Matching Rule | Backend Specification & Logic |
|---|---|---|
| **1** | **Exact Destination Match** | Seeker city and group post destination must match identically (`group.city.lower() == seeker.city.lower()`). Covers the 5 catalog cities: *Kyoto, Tokyo, Osaka, Dubai, Abu Dhabi*. |
| **2** | **Dates Overlap ≥ 2 Nights** | Overlap between `[group.check_in, group.check_out]` and `[seeker.check_in, seeker.check_out]` must be at least 2 shared nights: `(min(g_co, s_co) - max(g_ci, s_ci)).days >= 2`. |
| **3** | **Budget Compatibility (≤ 40%)** | The difference between budgets cannot exceed 40% of the lower budget: `abs(b1 - b2) <= 0.40 * min(b1, b2)`. |
| **4** | **Shared Interests (≥ 2)** | Seeker must share at least 2 interests with the group post creator/owner: `len(seeker_interests & owner_interests) >= 2`. |
| **5** | **Mutual Gender Preference** | Both preferences must allow the other: If seeker requires `SAME_GENDER`, owner must be the same gender; if owner requires `SAME_GENDER`, seeker must be the same gender. |
| **6** | **Group Capacity** | Current member count + seeker must not exceed group's maximum size: `len(member_ids) + 1 <= max_size`. |

---

## 🎬 How to Run the Judges' Live Demo (12 Minutes)

Use the built-in **Judges Live Demo Quick-Picks bar** at the top of the screen:

### Step 1: Scenario A (Sarah creates group post & manages members)
1. Click **`Scenario A: Sarah (Creator of G-01)`** in the top demo bar.
2. You are now acting as **Sarah Thomas** (`T-001`, Female, Same Gender preference, Kyoto 10–15 April 2027, budget ₹60,000).
3. Open the **"Create Group"** tab to see how Sarah or any creator can publish a new post (M2).
4. Open the **"Common Group Page"** tab for group `G-01` ("Kyoto Spring Temples").

### Step 2: Scenario B (Priya searches & expresses interest)
1. Click **`Scenario B: Priya (Search & Match G-01)`** in the demo bar.
2. You are now acting as **Priya Shah** (`T-002`, Female, Same Gender preference, Kyoto 9–16 April 2027, budget ₹62,000, interests: Temples, Street Food, Adventure).
3. The seeker search executes automatically. **Sarah's group `G-01` appears as an 87% match**!
4. Expand the **"All 6 Matching Rules Verified"** accordion on the card to see the breakdown:
   - *5 shared nights (10–15 April)*
   - *Budget diff ₹2,000 (3.3%), well within 40% limit*
   - *2 shared interests (TEMPLES, STREET_FOOD)*
   - *Mutual gender match (both FEMALE, SAME_GENDER)*
   - *Group capacity 1/3 (2 spots remaining)*
5. Click **"Express Interest"** on Sarah's card (M5).

### Step 3: Approve & Vote Together (Consensus Flow)
1. Click **`Scenario A`** to switch back to Sarah.
2. In the **Common Group Page**, notice the yellow notification panel: **`🔔 Pending Member Join Requests: Priya Shah requested to join!`**
3. Click **"✓ Approve"**. Priya is immediately added as an approved group member! Group capacity updates to 2/3.
4. Scroll to the **Smart Consensus Booking Engine**:
   - Members see verified hotel options in Kyoto (e.g., *Gion Corner Hotel*, *Gion Moon Ryokan*, etc.) with room capacity calculation (`2 members ÷ 2 adults/room = 1 room needed`), free room checks, and equal cost split (`₹23,800 total = ₹11,900 / member`).
   - Notice the **"Finalize Booking"** CTA button is **LOCKED and GREYED OUT**.
   - Sarah clicks **👍 Love it!** on *Gion Corner Hotel* (or any hotel).
   - In the sidebar, click the quick switcher **"Priya (Voting)"** to cast a vote as Priya, and click **👍 Love it!** on the same hotel.
   - **BAM! Unanimous 100% consensus reached!** The card glows emerald green, confetti bursts, and the **"Finalize Group Booking!"** CTA button unlocks with a pulsing green glow!
   - Click the CTA to confirm booking and view the official digital voucher.

---

## 🎨 Advanced Features & Updates

### 1. Dynamic Color-Coding for the Match Scorecard (Feature 3)
Previously, scorecard cards could show a sub-optimal overall score (e.g., 87%) while rendering generic green checkmarks across all rules. This has been updated with individual sliding-scale percentage calculations:
- **Sliding-Scale Rules:**
  - **Rule 2 (Date Overlap):** `(shared_nights / seeker_nights) * 100%`.
  - **Rule 3 (Budget Compatibility):** Closeness percentage to identical budgets within the 40% cap `(1 - diff / max_allowed_diff) * 100%`.
- **Individual Visual Markers & Colors:**
  - **Green Check (`✓`):** Rendered **only if that specific rule scores 95% or higher** (e.g. 100% date overlap, near-perfect budget match).
  - **Yellow Warning Marker (`⚠`):** Replaces the green checkmark with an amber warning badge and yellow text when a rule drags the overall score down (e.g., overlapping 5 of 7 nights = 71.4%, or ₹2,000 budget difference = 91.7%).
  - **Red Alert Marker (`✗`):** Replaces the green checkmark with bold red text when a rule significantly drags the score down (e.g., overlapping only 2 of 7 nights = 28.6%, or budget difference near the 40% limit).
- **Accordion Scorecard Header:** The scorecard toggle dynamically signals how many criteria drag the score down (e.g., `⚠ 3 criteria drag score down (87%)`).

### 2. Auto-Decline Expiring Requests (Feature 4)
A time-based auto-rejection system implemented purely in the Python backend:
- **Auto-Decline Trigger:** Whenever the system evaluates or fetches pending requests (or when a seeker expresses interest), the group's `check_in` date is evaluated against the current date.
- **Rule:** If the trip departure is **5 days away or less** (`days_until <= 5`) and a seeker's request is still `'PENDING'`, the backend automatically updates the status in SQLite to `'REJECTED'`.
- **Seeker UI Alert:** The seeker sees a clean UI warning banner stating:
  > **`⚠️ Request automatically declined (trip departs in X days)`**  
  > *Automated system check: Trip departure window is 5 days or less.*
- **Interactive Testing Demo Chip:**
  - Click the **`⏳ Test Auto-Decline (Trip in ≤5d)`** button in the top demo bar.
  - This toggles the simulated system date to `2027-04-06` (4 days prior to Sarah's Kyoto trip `2027-04-10`).
  - Any pending or new join requests for group `G-01` are instantly auto-declined, updating the match card with the auto-decline banner and removing the request from the creator's pending list!

---

## 🏗️ Architecture & Technical Stack

```
groupmatcher/
├── server.py              # Pure Python BaseHTTPRequestHandler + SQLite3 database
├── index.html             # Semantic HTML5 unified single-page layout
├── style.css              # Custom design system (CSS variables, Grid, Flexbox, animations)
├── app.js                 # Vanilla JS (ES6+) Fetch API client and UI controller
├── groupmatcher.db        # Persistent SQLite database (auto-created and seeded)
├── README.md              # Documentation and startup instructions
└── datasets/              # Read-only competition mock data
    ├── data/
    │   ├── problem-3/     # travellers.json, groups.json, interests.json
    │   └── catalog/       # destinations.json, hotels.json, rooms.json, availability.json
    └── images/hotels/     # Real generic hotel photos with CC attribution
```

### Backend Components (`server.py`)
- **No external dependencies**: Pure Python standard library (`http.server`, `sqlite3`, `json`, `datetime`, `math`).
- **REST Endpoints**:
  - `GET /api/bootstrap`: Delivers destinations, interests, and travellers.
  - `GET/POST /api/travellers`: Profile lookup & M1 sign-up.
  - `GET/POST /api/groups`: Group posts listing & M2 creation.
  - `POST /api/match`: The 6-rule matching engine with diagnostic breakdowns.
  - `POST /api/groups/join`: M5 join request creation.
  - `GET /api/groups/<id>/requests`: M5 pending request management.
  - `POST /api/groups/<id>/requests/decide`: M5 creator approval/rejection.
  - `GET /api/groups/<id>/hotels`: M6 hotel room availability, capacity formula, and cost split.
  - `POST /api/groups/<id>/vote`: Wow Factor Tinder hotel voting consensus engine.
  - `POST /api/groups/<id>/book`: Group booking finalization.
  - `GET/POST /api/groups/<id>/chat`: S1 coordination chat.
- **State Persistence**: SQLite3 database (`groupmatcher.db`) ensures user profiles, groups, memberships, votes, and bookings survive browser refreshes and server restarts.

### Frontend Components (`index.html`, `style.css`, `app.js`)
- **Design System**: Booking.com and Airbnb inspired luxury aesthetics, with deep navy, booking blue, and vibrant emerald accents.
- **Client Filtering (G1)**: Filter search results by shared interests and gender composition.
- **Member Inspection (G2)**: Modal cards to inspect travellers' ages, origins, interests, and groups.
- **Group Chat (S1)**: In-page discussion room for real-time member coordination.
- **Confetti Canvas**: Custom particle system for gamified consensus celebration.

---

## 🛡️ Known Limitations & Design Choices

1. **Data Catalog Boundaries**: In strict compliance with hackathon rules, searches and group posts are constrained to the 5 cities (Tokyo, Kyoto, Osaka, Dubai, Abu Dhabi) and the date window of **1 to 20 April 2027**.
2. **Fixed Memberships**: Once an approved seeker joins a group, their membership is committed to the shared booking flow.
3. **Pure Python Server**: Uses `http.server.HTTPServer` for simplicity and adherence to the zero-framework rule.
