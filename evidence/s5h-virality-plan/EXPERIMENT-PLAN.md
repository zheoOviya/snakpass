# S5H Virality Experiments — Plan First

## Directive: PRODUCT-GJ02-SOCIAL-S5H-VIRALITY-EXPERIMENTS-PLAN-FIRST-13
## Verdict: S5H_EXPERIMENT_PLAN_READY
## Baseline: b2bcca8f93b965e7dcce5d95a5ecc209b0f3edaa

---

## 1. Product Objective

SnakZap is a **campus food-ordering platform** (pickup-first, zero delivery). The North Star metric is "Time from order to first bite."

Social features exist to improve **two product outcomes**:

1. **Restaurant discovery** — Friends' ordering activity helps users discover new restaurants/dishes they wouldn't have found alone. This drives **repeat ordering** (the core revenue driver).
2. **Retention via social obligation** — Gift food, group orders, and friend activity create lightweight social obligations that bring users back to the app.

**NOT the objective:** Generic engagement (time-in-app, like counts, notification volume). These are vanity metrics unless they demonstrably drive discovery or retention.

---

## 2. Current Reusable Social Signals

| Signal | Source | Authoritative? | Currently Used? |
|--------|--------|---------------|-----------------|
| Friend graph (ACCEPTED edges) | SocialConnection table | Yes (DB truth) | Yes — feed filter, fanout |
| Activity stream (ORDERED, GIFTED, etc.) | SocialActivity table | Yes (DB truth) | Yes — feed, home screen |
| Like count + likedByMe | Like table + feed projection | Yes (DB truth) | Yes — feed card |
| Activity visibility (FRIENDS/PUBLIC/PRIVATE) | SocialActivity.visibility | Yes (DB truth) | Yes — feed filter, fanout |
| Notifications (friend request, like, gift, etc.) | Notification table | Yes (DB truth) | Yes — bell, realtime |
| Restaurant popular items | restaurants/[id] API | **Placeholder** (first 3 items, no real signal) | Yes — but fake popularity |
| Friends' restaurant orders | SocialActivity where verb=ORDERED | Yes (DB truth) | Partially — feed card shows restaurant name |
| Gift lifecycle | Gift table (CREATED→PAID→REDEEMED) | Yes (DB truth) | Yes — gift CTA, notification |
| Group order participation | GroupOrder + GroupOrderMember | Yes (DB truth) | Yes — group order CTA |
| Campus affinity | User.campusId | Yes (DB truth) | Yes — restaurant filter |

**Key gap:** Restaurant detail page has NO social signals. "Popular items" is a placeholder (first 3 by name, not actual popularity). This is the highest-value insertion point for virality.

---

## 3. Candidate Virality Loops

### V1: Friend activity social proof (ALREADY EXISTS)
- **Trigger:** User opens home screen
- **Action:** Sees "Friends Ordering Nearby" section with SocialFeedCards
- **Reward:** Discovers restaurant friend ordered from
- **Reinvestment:** User orders from discovered restaurant → their activity appears in friends' feeds
- **Verdict:** RETAIN — already implemented, drives discovery

### V2: "Friends liked this" signal on restaurant detail
- **Trigger:** User opens restaurant detail page
- **Action:** Sees "X friends ordered from here" or "Your friend liked {dish}"
- **Reward:** Social proof reduces decision friction
- **Reinvestment:** User orders → their activity feeds friends' discovery
- **Verdict:** **VIABLE** — high impact, low effort, preserves privacy

### V3: Popular among friends (restaurant ranking)
- **Trigger:** User browses home screen "Popular Near You"
- **Action:** Restaurants ranked by friend activity count, not just rating
- **Reward:** Friend-curated discovery > algorithmic popularity
- **Reinvestment:** Ordering boosts restaurant's friend-popularity
- **Verdict:** **VIABLE** — replaces fake "popular items" with real friend signal

### V4: Realtime activity appearance (ALREADY EXISTS)
- **Trigger:** Friend creates activity
- **Action:** User's open feed updates without reload (S5D verified)
- **Reward:** Immediate awareness of friend's order
- **Reinvestment:** User orders → realtime feed update for friends
- **Verdict:** RETAIN — S5D infrastructure already delivers this

### V5: Share/invite flow
- **Trigger:** User completes order or receives gift
- **Action:** "Share with a friend" CTA → deep link
- **Reward:** Friend discovers restaurant
- **Reinvestment:** Friend orders → both get activity in feed
- **Verdict:** **REJECT FOR NOW** — requires deep-link infrastructure, share target (WhatsApp/Telegram), and offline tracking. High effort, uncertain campus adoption. Defer to S5H3 wave.

### V6: Restaurant discovery through friends
- **Trigger:** User opens restaurant detail
- **Action:** "3 of your friends ordered here" + friend avatars
- **Reward:** Trust signal reduces ordering anxiety
- **Reinvestment:** User orders → their avatar appears for their friends
- **Verdict:** **VIABLE** — same as V2, different presentation (avatars vs text)

### V7: Friend-based recommendation seed
- **Trigger:** User has 0-2 orders (new user)
- **Action:** "Your friends are ordering from: {restaurant}" prompt
- **Reward:** Cold-start discovery for new users
- **Reinvestment:** New user orders → becomes discovery node for their friends
- **Verdict:** **VIABLE** — targeted at new users, high impact on activation

### V8: Lightweight activity aggregation
- **Trigger:** User opens home screen
- **Action:** "5 friends ordered from restaurants near you this week"
- **Reward:** Broader social proof than individual cards
- **Reinvestment:** User's orders contribute to aggregate count
- **Verdict:** **REJECT** — adds noise without actionable signal. Individual cards (V1) already provide better granularity.

### V9: Re-engagement notification
- **Trigger:** User hasn't ordered in 7+ days, friend orders from nearby restaurant
- **Action:** Push notification: "{friend} just ordered from {restaurant}"
- **Reward:** Social obligation pulls user back
- **Reinvestment:** User orders → triggers re-engagement for their dormant friends
- **Verdict:** **REJECT FOR NOW** — notification fatigue risk. Requires careful rate limiting + opt-out. Defer to S5H3 wave after measuring baseline notification engagement.

### V10: Mutual-friend/context signal
- **Trigger:** User views friend's profile or activity
- **Action:** "You and {friend} have 3 mutual friends who ordered from {restaurant}"
- **Reward:** Stronger social proof via mutual connections
- **Reinvestment:** User orders → becomes mutual context for others
- **Verdict:** **REJECT** — requires profile page (doesn't exist), graph traversal, and risks privacy leakage (mutual friend exposure). High complexity, marginal value over V2/V6.

---

## 4. Rejected Loops + Reasons

| Loop | Reason |
|------|--------|
| V5 Share/invite | Requires deep-link infra + share target + offline tracking. High effort, uncertain adoption. |
| V8 Activity aggregation | Noise without actionable signal. Individual cards (V1) already provide better granularity. |
| V9 Re-engagement notification | Notification fatigue risk. Requires rate limiting + opt-out. Defer until baseline engagement measured. |
| V10 Mutual-friend signal | Requires profile page, graph traversal, privacy risk. Marginal value over V2/V6. |

---

## 5. Privacy Challenge

All viable experiments (V2, V3, V6, V7) must preserve:

| Privacy Contract | How Preserved |
|-----------------|---------------|
| FRIENDS visibility | Only count activities with visibility=FRIENDS or PUBLIC. PRIVATE excluded. |
| Block isolation | SocialConnection where status=ACCEPTED only. Blocked users excluded from count. |
| Phone privacy | No phone numbers in any signal — only userId (for avatar) + name (for "friend ordered") |
| No private graph leakage | "Friends ordered here" only shows COUNT + avatars, never the full friend list or who specifically ordered what |
| No covert recommendation from blocked users | Fanout queries current SocialConnection status at render time. Blocked users don't appear. |
| No notification spam | V2/V3/V6/V7 are passive UI signals on existing pages, NOT push notifications. No new notification types. |

**Privacy-sensitive experiments:** None of the viable experiments introduce new notification types or push channels. All are passive UI enhancements on existing pages (restaurant detail, home screen).

---

## 6. Abuse Challenge

| Abuse Vector | Control |
|-------------|---------|
| Like farming | Like has @@unique([userId, activityId]). One like per user per activity. No multiplier effect. |
| Fake accounts | OTP login required. Campus-binding required. Phone verification. Rate limiting on friend requests (S4B). |
| Reciprocal-like rings | Like count is NOT the primary metric. Primary metric is restaurant-detail-open-from-social. Like farming doesn't boost discovery ranking. |
| Activity spam | Activities are created by real order/gift/group-order events, not user-initiated. No "post activity" API. |
| Invite spam | V5 (share/invite) rejected for now. No invite API in S5H1. |
| Ranking manipulation | V3 (popular among friends) counts distinct friends who ordered, not like count. Ordering requires real payment. |
| Notification farming | No new notifications in S5H1. Existing notification rate limiting (S3) preserved. |

**Minimum abuse controls before launch:** All already in place (S4A block, S4B privacy, S4C audit, unique constraints). No new controls needed for S5H1.

---

## 7. Metrics / Guardrails

### Primary metric (all experiments)
- **Restaurant detail opens from Social surface** — tracks how often a user opens a restaurant detail page after seeing a social signal (friend activity, "friends ordered here" badge, etc.)

### Guardrail metrics
- **Friend request acceptance rate** — should not decrease (no notification spam)
- **Block rate** — should not increase (no unwanted social exposure)
- **Notification opt-out rate** — should not increase (no new notification types in S5H1)
- **Feed engagement** — time spent on Social tab should not decrease

### Counter-metrics
- **Like count** — NOT a success metric. Like farming doesn't drive discovery.
- **Raw notification volume** — NOT a success metric.
- **Time-in-app** — NOT a success metric (vanity).

### Experiment measurement
- A/B test: 50% of users see social signal (V2/V3/V6/V7), 50% see baseline (no social signal on restaurant detail)
- Duration: 2 weeks minimum for statistical significance
- Success criteria: 10%+ increase in restaurant-detail-opens-from-social in treatment group

---

## 8. Ranked Experiment Shortlist

| Rank | Experiment | Impact | Confidence | Effort | Privacy Risk | Abuse Risk | Score |
|------|-----------|--------|-----------|--------|-------------|-----------|-------|
| 1 | **V2+V6: "Friends ordered here" on restaurant detail** | High | High | Low | Low | Low | **9/10** |
| 2 | **V3: Friend-activity-ranked "Popular Near You"** | Medium | High | Medium | Low | Low | **7/10** |
| 3 | **V7: New-user friend recommendation seed** | Medium | Medium | Medium | Low | Low | **6/10** |

**Selected for S5H1:** V2+V6 (combined — same backend query, different UI presentation)

---

## 9. Minimum Viable Experiment

### S5H1: "Friends Ordered Here" Social Proof

**What:** When a user opens a restaurant detail page, show "X of your friends ordered from here" with friend avatars (max 3).

**Backend:**
- New API: `GET /api/restaurants/[id]/social-proof` → `{ friendCount, friendAvatars: [{id, name, avatarColor}] }`
- Query: `SocialActivity WHERE actorId IN (accepted friends of current user) AND objectId = restaurantId AND visibility IN ('FRIENDS','PUBLIC')`
- Only counts distinct friends (not orders). Max 3 avatars for privacy.
- Block isolation: SocialConnection where status=ACCEPTED only.

**Frontend:**
- Restaurant detail screen: new section above "Popular Items"
- Shows: "👥 3 friends ordered here" + avatar stack (max 3) + "View" button
- Tapping avatars → Social feed filtered to that restaurant

**Privacy:** No new notifications. No PII beyond name + avatarColor (already in feed). Friend count is aggregate (no "who ordered what").

**Abuse:** No new abuse surface. Ordering requires payment. Friend count can't be inflated without real orders.

**Metric:** Track `restaurant_detail_open_from_social_proof` event when user taps a restaurant from the social proof section.

---

## 10. Expected Affected Files/Components

### S5H1 (V2+V6: Friends Ordered Here)
| File | Change |
|------|--------|
| `src/app/api/restaurants/[id]/social-proof/route.ts` | NEW — social proof query |
| `src/components/snak/screens/restaurant-detail-screen.tsx` | ADD — social proof section |
| `src/lib/social-store.ts` | ADD — `fetchSocialProof(restaurantId)` |
| `src/lib/types.ts` | ADD — `SocialProof` type |
| No changes to: realtime, notifications, like, connection routes | — |

### S5H2 (V3: Friend-ranked Popular — future)
| File | Change |
|------|--------|
| `src/app/api/restaurants/route.ts` | MODIFY — add friend-activity count to restaurant list |
| `src/components/snak/screens/home-screen.tsx` | MODIFY — sort "Popular Near You" by friend activity |

### S5H3 (V7: New-user seed — future)
| File | Change |
|------|--------|
| `src/components/snak/screens/home-screen.tsx` | ADD — "Friends are ordering from" section for new users |
| `src/app/api/restaurants/route.ts` | MODIFY — friend-activity-ranked restaurants for new users |

---

## 11. Implementation Waves

### Wave 1: S5H1 — Social Proof (2-3 days)
- V2+V6: "Friends ordered here" on restaurant detail
- Backend: new social-proof API endpoint
- Frontend: restaurant detail section
- Measurement: track social-proof → restaurant-detail-open events
- Privacy: passive UI, no new notifications, no PII leakage

### Wave 2: S5H2 — Friend-Ranked Discovery (2-3 days, after S5H1 measured)
- V3: Friend-activity-ranked "Popular Near You"
- Replaces fake "popular items" placeholder with real friend signal
- Backend: modify restaurants list API to include friend-activity count
- Frontend: sort/filter home screen restaurant grid

### Wave 3: S5H3 — New-User Activation (2-3 days, after S5H2)
- V7: Friend recommendation seed for new users (0-2 orders)
- Targeted prompt: "Your friends are ordering from {restaurant}"
- Backend: friend-activity-ranked restaurants filtered by user's order count
- Frontend: conditional section on home screen for new users

### Wave 4: S5H4 — Measurement & Closure (1-2 days)
- A/B test infrastructure (if not already present)
- Event tracking for social-proof → restaurant-detail-open funnel
- Guardrail metrics dashboard
- Experiment closure report

---

## 12. Risks / Blockers

| Risk | Mitigation |
|------|-----------|
| Friend graph too sparse (new campus) | S5H1 degrades gracefully — if 0 friends ordered, section hidden. No empty state needed. |
| SQLite write contention on social-proof query | Query is read-only (no writes). SQLite handles concurrent reads fine. |
| Privacy: friend count leaks graph density | Only shows max 3 avatars. Count is capped at "3+" if more. No exact count beyond 3. |
| Abuse: coordinated ordering to boost restaurant ranking | V3 counts distinct friends, not orders. Ordering requires payment. Cost of abuse > value. |
| Measurement: no A/B test infrastructure | S5H1 can launch as feature flag (on/off). Compare before/after with cohort analysis. |
| Notification fatigue | S5H1 introduces NO new notifications. All signals are passive UI on existing pages. |

---

## FINAL VERDICT

```text
S5H_EXPERIMENT_PLAN_READY
```

NO PRODUCT IMPLEMENTATION in this phase. Plan only.
Next step: S5H1 implementation wave when directed.
