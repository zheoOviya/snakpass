# Task 2C — Explore screen + restaurant API additive extensions
**Agent**: full-stack-developer (Wave 2 Task 2C)
**Status**: COMPLETE — all acceptance criteria pass

## Files owned (created / modified)
- CREATED `src/components/snak/screens/explore-screen.tsx` (~1170 LOC) — full Explore screen per blueprint §10
- MODIFIED `src/app/api/restaurants/route.ts` — additive `campusId` query param + `rewardMultiplier`/`isOpen`/`deal` response fields
- MODIFIED `src/app/api/restaurants/[id]/route.ts` — additive `rewardMultiplier`/`deals`/`popularItems`/`campuses` fields
- MODIFIED `src/app/api/restaurants/[id]/menu/route.ts` — additive `rewardPoints`+`modifiers` per item, +`rewardMultiplier` at root

## Governance respected
- ❌ Did NOT touch `consumer-view.tsx` (Task 2B owns).
- ❌ Did NOT touch `app-shell.tsx` (Task 2B owns).
- ❌ Did NOT touch `restaurant-detail-screen.tsx` (Task 2D owns — note another agent is also writing into `screens/` folder).
- ❌ Did NOT touch `prisma/schema.prisma`, `razorpay.ts`, `reconciliation.ts`, `pickup-attribution.ts`, `fulfilment-state.ts`, `state-invariants.ts`, `deployment.ts`.
- ❌ Did NOT touch any of `orders/*`, `payments/*`, `webhooks/*`, `reconciliation/*` API routes.
- ❌ Did NOT touch `src/lib/types.ts` (kept additive fields as local interface `RestaurantListItem extends Restaurant` inside explore-screen.tsx).

## Verification
- `bunx eslint <my-files> --max-warnings 0` → EXIT 0 (zero errors, zero warnings).
- `bunx tsc --noEmit --skipLibCheck` → ZERO new errors in my 4 files (174 pre-existing errors all in protected files: razorpay.ts, pickup-attribution.ts, state-invariants.ts, webhook-processor.ts, supabase.ts, errors.ts).
- `curl http://localhost:3000/api/restaurants?campusId=cmt1g6wpi0035...` → 200, 4 restaurants (IIM Bangalore).
- `curl http://localhost:3000/api/restaurants?campusId=cmt1g6wpj0037...` → 200, 2 restaurants (Christ University).
- `curl http://localhost:3000/api/restaurants?campusId=cmt1g6wpg0034...` → 200, 0 restaurants (IIT Bombay — empty set).
- `curl http://localhost:3000/api/restaurants?q=dosa` → 200, 1 match (Dosa Den).
- `curl http://localhost:3000/api/restaurants?veg=1` → 200, 4 (all seed restaurants happen to have veg items).
- `curl http://localhost:3000/api/restaurants/[id]` → 200 with `rewardMultiplier=1`, `deals=[{title:"Great value", description:"Under ₹300 for two"}]` (for Sweet Tooth ₹250), `popularItems=3` (Cappuccino/Cold Coffee/Blueberry Cheesecake), `campuses=["IIM Bangalore","Christ University"]`.
- `curl http://localhost:3000/api/restaurants/[id]/menu` → 200 with `rewardPoints=Math.floor(price/100 * 0.1 * 1)` per item (Cappuccino ₹100 → 10 pts) + `modifiers=[]` placeholder + root `rewardMultiplier=1`.
- Dev log: no runtime errors. All Prisma queries execute cleanly (junction + parallel Promise.all in [id] route).

## Coordination notes for Wave 2 Task 2B (consumer-view.tsx wiring)
- `ExploreScreen` accepts `{ onSelectRestaurant: (id: string) => void }` prop.
- Render `<ExploreScreen onSelectRestaurant={(id) => setView('menu', id)} />` inside consumer-view's `view === 'browse'` branch.
- No further wiring needed — internal state + fetch logic is self-contained.
- Optional: pass `className` for layout adjustments if needed.
- Server-side filters used: `q`, `veg`, `campusId` (via campus-store's selectedCampusId).
- Client-side filters (post-fetch): openNow / offers / rating≥4.0 / cuisines / priceRange / sort.

## Known issues / follow-ups
- Pre-existing lint error in `home-screen.tsx` (Task 2B owns — `react-hooks/refs` "Cannot access refs during render" at line 832). NOT mine. Breaks `bun run lint` globally but my files lint clean.
- `popularItems` is a placeholder using `take: 3` available items ordered by category/name (no real popularity signal yet). Future: derive from order history counts.
- `deal` is derived from `priceForTwo < ₹30000 paise` (₹300 for two). Future: real Deal model rows.
- `rewardMultiplier` is hard-coded to 1.0 in all three API routes. Future: per-restaurant config column or promotional rule.
- `modifiers` per menu item is empty array placeholder. Future: customization options (size, add-ons, spice).
