# SNAKZAP — PREMIUM DESIGN SYSTEM

**Document type:** Authoritative UI design system specification
**Owner:** Frontend / Design
**Version:** 1.0 (DESIGN-01)
**Status:** Ready for implementation
**Companion files:** `src/app/design-tokens.css` (CSS variable tokens — import after tailwind in `globals.css`)

---

## 0. HOW TO USE THIS DOCUMENT

This is a **specification, not a codebase**. Each component section describes **purpose, anatomy, states, mobile/desktop variants, micro-interactions, and accessibility notes** — enough for a developer to implement without ambiguity.

**Token reference:** every color, font, spacing, radius, shadow, motion, and z-index value referenced below is defined as a CSS custom property in `src/app/design-tokens.css`. Tailwind 4 `@theme inline` exposes them as utility classes (e.g. `--color-gold-500` → `bg-gold-500`, `text-gold-500`, `border-gold-500`).

**Two-file system:**
- `src/app/globals.css` — existing shadcn base tokens (background, foreground, card, popover, muted, border, input, ring, sidebar-*) — UNCHANGED
- `src/app/design-tokens.css` — NEW: brand ramps, semantic accents, typography, spacing, radius, shadow, motion, z-index, glassmorphism/gradient utilities

**To activate the tokens**, add one line to `src/app/globals.css` after the existing imports:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "./design-tokens.css";   /* ← add this line */
```

This is the only modification required. The instruction for DESIGN-01 was to NOT modify globals.css; that decision is left to the next task as a single-line import addition.

---

## 1. DESIGN PHILOSOPHY

### 1.1 The product in one sentence
SnakZap is a **social food-ordering app for Indian college campuses** — order ahead, skip the line, earn rewards, gift food to friends, and see what your campus is eating.

### 1.2 Design principles
1. **Modern, warm, social, campus-vibrant.** Not corporate. Not cold. The product lives in student pockets — it should feel like a friendly campus guide, not a banking app.
2. **NOT a Snackpass copy** (blueprint §33). We benchmark feature parity, not visual parity. Snackpass is blue/purple; we are teal/emerald with a warm accent system.
3. **Mobile-first, thumb-friendly, bottom-sheet oriented.** Default surface is a phone screen. Every primary action is reachable with the thumb on a 6.1" device without grip shift.
4. **Micro-interactions everywhere** — every tap, every state change, every reward earned should respond with motion (framer-motion). But motion is **subtle**, never decorative-for-decoration's-sake.
5. **Premium = polish, not complexity.** Premium feel comes from: consistent 4px spacing rhythm, soft multi-layer shadows, smooth 60fps motion, generous whitespace, considered empty states, and a refined color ramp. It does NOT come from more features or more gradients.
6. **Color has semantic meaning.** Teal = brand/action. Gold = reward. Violet = social/friends. Rose = group orders. Red = danger. Emerald-green = success. Each accent is used consistently — never arbitrary.
7. **Indian context is first-class.** INR currency, veg/non-veg badges, spice levels, UPI payment, Devanagari script support, rupee-friendly pricing.
8. **Accessibility is non-negotiable.** AA contrast minimum, 44px touch targets, visible focus rings, reduced-motion support.

### 1.3 Reference quality bar
Think **Linear** (typography, polish, motion), **Notion** (warmth, hierarchy, empty states), **Arc browser** (color confidence, gradient meshes, modern surfaces) — applied to a social food app for Indian students.

### 1.4 What "premium" is NOT
- Not a dark UI by default (light is primary; dark is opt-in via next-themes)
- Not heavy glassmorphism everywhere (used surgically on overlays only)
- Not animated logos / splash screens
- Not gradient text
- Not flat illustrations (we use photography + Lucide icons + emoji sparingly)

---

## 2. COLOR SYSTEM

### 2.1 Token architecture

The color system has three layers:

1. **Brand ramps** (50–950) — full color ramps for each brand color. Used in gradients, charts, hover states, and anywhere a single-step token is too coarse.
2. **Semantic accents** (single-step) — `--reward`, `--social`, `--group`, `--success`, `--danger`, `--warning`, `--info`, plus `-foreground` and `-muted` variants. These map to the brand ramps and flip in dark mode.
3. **shadcn base tokens** (existing) — `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--border`, `--input`, `--ring`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--sidebar-*`. We **refine** `--primary` to the new teal-600 anchor (light) / teal-500 (dark) and align `--destructive` with the danger ramp. All others stay as defined in `globals.css`.

### 2.2 Primary — Teal/Emerald (existing, refined)

| Token | Light | Dark | Role |
|------|-------|------|------|
| `--teal-500` | brand anchor | dark CTA partner | logo, primary gradient start |
| `--teal-600` | primary CTA | — | main buttons, active states |
| `--emerald-500/600` | gradient end | gradient end | hero gradients, success-adjacent |
| `--ring` | teal-500 | teal-400 | focus rings |

**Gradient direction:** `linear-gradient(135deg, teal-500 0%, emerald-600 100%)` — diagonal NW→SE, warmer than horizontal.

### 2.3 Accent — Rewards (Gold/Amber)

| Token | Role |
|------|------|
| `--gold-500` (light) / `--gold-400` (dark) | reward points balance, progress ring fill, coin icon, "earned X points" toast |
| `--reward-muted` (gold-100 / dark surface) | reward card background tint |
| `--reward-foreground` | text on gold surfaces (dark brown-gold) |

**Gradient:** `linear-gradient(135deg, gold-300 → gold-500 → gold-600)` — for reward rings, points badges, celebration toasts. Adds a "shine" via the 300→600 progression.

### 2.4 Accent — Social (Violet)

| Token | Role |
|------|------|
| `--violet-500` (light) / `--violet-400` (dark) | friend avatars border, social feed highlights, gift-send buttons |
| `--social-muted` | social card background tint |
| `--social-foreground` | text on violet surfaces (white in light, near-black in dark) |

**Gradient:** `linear-gradient(135deg, violet-400 → violet-600)` — for "send gift" CTA, social feed actor chips.

### 2.5 Accent — Group orders (Rose/Pink)

| Token | Role |
|------|------|
| `--rose-500` (light) / `--rose-400` (dark) | group order bubbles, "join order" buttons, member-count badges |
| `--group-muted` | group card background tint |
| `--group-foreground` | text on rose surfaces |

**Gradient:** `linear-gradient(135deg, rose-400 → rose-600)` — group order CTA, member-joined pulse.

### 2.6 Accent — Danger (Red)

| Token | Role |
|------|------|
| `--danger-500` (light) / `--danger-400` (dark) | cancel order, delete, error states, destructive CTA |
| `--destructive` (shadcn) = `--danger-500` | maps shadcn destructive to danger ramp |

### 2.7 Accent — Success (Emerald-green)

| Token | Role |
|------|------|
| `--success-500` (light) / `--success-400` (dark) | "Order confirmed", "Picked up", "Payment captured", success toasts |

**Note:** Success emerald is **distinct** from the primary emerald ramp (slightly shifted hue 142 vs 150) so success states read as "done" rather than "branded".

### 2.8 Warning & Info

| Token | Role |
|------|------|
| `--warning` | prep delay banner, expiring gift, points expiring |
| `--info` (= teal-500/400) | info banners, neutral notifications |

### 2.9 Surface tokens (existing in globals.css — kept)

| Token | Light | Dark | Role |
|------|-------|------|------|
| `--background` | near-white oklch(0.99 0.005 180) | near-black oklch(0.16 0.015 200) | app background |
| `--foreground` | near-black oklch(0.18 0.02 200) | near-white oklch(0.97 0.005 180) | primary text |
| `--card` | white oklch(1 0 0) | elevated dark oklch(0.21 0.02 200) | card surfaces |
| `--popover` | white | elevated dark | dropdowns, popovers |
| `--muted` | soft warm neutral oklch(0.965 0.008 178) | dark neutral oklch(0.27 0.025 200) | skeleton shimmer, muted backgrounds |
| `--muted-foreground` | oklch(0.5 0.018 188) | oklch(0.72 0.015 190) | secondary text |
| `--border` | oklch(0.9 0.015 180) | oklch(1 0 0 / 12%) | dividers, card borders |

### 2.10 Text tokens (recommended usage pattern)

We use the existing shadcn tokens plus a convention for three text hierarchy levels:
- `--foreground` — primary text (titles, totals, primary labels)
- `--muted-foreground` — secondary text (descriptions, timestamps, helper text)
- A new convention `text-foreground/60` — tertiary/subtle text (micro-labels, captions inside dense rows). Tailwind opacity modifier on foreground works because foreground is dark in light mode (so 60% is grayish) and light in dark mode (so 60% is muted gray).

### 2.11 Full ramp reference

All ramps live in `src/app/design-tokens.css`. Quick visual reference:

| Step | Teal | Emerald | Gold | Violet | Rose | Danger | Success |
|------|------|---------|------|--------|------|--------|---------|
| 50   | palest teal tint | palest emerald tint | palest cream | palest lavender | palest pink | palest red | palest green |
| 500  | **brand anchor** | gradient end | **reward coin** | **social** | **group** | **danger** | **success** |
| 950  | darkest teal | darkest emerald | darkest bronze | darkest violet | darkest rose | darkest red | darkest green |

(Each step's exact OKLCH value is in the tokens file.)

### 2.12 Cuisine gradients (preserved from existing implementation)

Restaurant cards use cuisine-tinted gradient headers. These are **decorative** gradients (not semantic) and live in `bits.tsx` via the existing `cuisineGradient()` helper. They stay vibrant in both themes — we do NOT mute them in dark mode.

| Cuisine family | Gradient |
|----------------|---------|
| South Indian | amber-400 → emerald-500 |
| North Indian | rose-400 → amber-500 |
| Chinese | red-500 → gold-500 |
| Desserts/Bakery | pink-300 → violet-400 |
| Beverages | teal-400 → cyan-400 |
| Default | teal-500 → emerald-600 |

---

## 3. TYPOGRAPHY

### 3.1 Font stack

| Token | Family | Loaded via | Role |
|-------|--------|-----------|------|
| `--font-display` | **Plus Jakarta Sans** | `next/font/google` (to add) | display headings, hero numbers, point balances |
| `--font-sans` | **Geist Sans** (already loaded in layout.tsx) | existing | body text, UI labels, buttons |
| `--font-mono` | **Geist Mono** (already loaded) | existing | OTP codes, order IDs, prices in totals, pickup codes |
| `--font-devanagari` | **Noto Sans Devanagari** | `next/font/google` (to add) | Hindi/Marathi menu items & restaurant names |

**Why Plus Jakarta Sans for display:** warm geometric with friendly terminals, supports Indian digit forms well, pairs with Geist Sans (similar x-height) without competing. The display face is reserved for **moments that need weight**: hero numbers ("₹247 saved this month", "1,240 pts"), big section headers, onboarding titles. Body never uses display.

**Devanagari fallback:** the `--font-sans-stack` includes Noto Sans Devanagari as fallback so Hindi text in body always renders correctly. Menu items with Hindi names automatically fall back. Loading Noto Sans Devanagari via `next/font/google` with `subsets: ['devanagari', 'latin']` is recommended for first-paint quality.

### 3.2 Type scale

| Token | Size | Line height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `--text-display` | 40px / 2.5rem | 1.1 | 700 | hero balances, onboarding title |
| `--text-h1` | 32px / 2rem | 1.15 | 700 | screen titles (rare on mobile — usually h2) |
| `--text-h2` | 24px / 1.5rem | 1.2 | 600 | section headers, restaurant name on detail |
| `--text-h3` | 20px / 1.25rem | 1.3 | 600 | card titles, modal titles |
| `--text-body-lg` | 18px / 1.125rem | 1.5 | 400 | lead paragraphs, onboarding body |
| `--text-body` | 16px / 1rem | 1.55 | 400 | default body text |
| `--text-small` | 14px / 0.875rem | 1.45 | 400 | secondary labels, metadata |
| `--text-caption` | 12px / 0.75rem | 1.4 | 500 | timestamps, badge text |
| `--text-micro` | 11px / 0.6875rem | 1.3 | 600 | uppercase eyebrow labels, micro-metadata |

**Weights used:** regular (400), medium (500), semibold (600), bold (700). Avoid `font-extrabold` (800+) — feels heavy on small screens.

### 3.3 Mobile type rules
- Display is used **max once per screen** (usually never on regular screens — only onboarding/celebration).
- h1 is rare on mobile — prefer h2 (24px) as the largest in-screen title.
- Body text uses 16px minimum (never below). Small (14px) is the floor for secondary labels. Caption (12px) only for non-essential metadata. Micro (11px) only for uppercase eyebrows like "ORDER #SNZ-12345".

### 3.4 Numeric emphasis
Prices, point balances, OTP codes, and pickup codes use `--font-mono` (Geist Mono) for **tabular alignment**. Bold weight + increased letter-spacing on OTP:
```
font-mono text-3xl font-bold tracking-[0.3em] text-teal-700
```
(This pattern already exists in `order-tracking.tsx` — preserve it.)

---

## 4. SPACING & LAYOUT

### 4.1 Base grid
**4px base unit** — every padding, margin, gap is a multiple of 4 (1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 in `--space-*` tokens).

### 4.2 Container max-widths

| Token | Value | Use |
|-------|-------|-----|
| `--max-w-mobile` | 28rem (448px) | single-column phone content (forms, login) |
| `--max-w-sm` | 36rem (576px) | compact cards grid container |
| `--max-w-md` | 48rem (768px) | 2-column grid breakpoint |
| `--max-w-lg` | 64rem (1024px) | 3-column grid breakpoint |
| `--max-w-xl` | 80rem (1280px) | desktop max |

**App container:** the consumer app uses `max-w-md mx-auto` (768px) on desktop — wider feels like a desktop site, narrower feels like a phone. 768px is the sweet spot for a "phone-like app on desktop".

### 4.3 Key heights

| Token | Value | Role |
|-------|-------|------|
| `--height-app-bar` | 56px | sticky top app bar |
| `--height-app-bar-safe` | 56px + safe-area-inset-top | with notch |
| `--height-bottom-nav` | 64px | bottom nav bar |
| `--height-bottom-nav-safe` | 64px + safe-area-inset-bottom | with home indicator |
| `--height-sticky-cta` | 72px | sticky CTA bar (above bottom nav) |

### 4.4 Card padding convention

| Surface | Padding |
|---------|---------|
| Card content (default) | `p-4` (16px) |
| Card content (dense — menu rows, order items) | `p-3` (12px) |
| Card content (spacious — onboarding, hero) | `p-6` (24px) |
| Inner element gap (default) | `gap-4` (16px) |
| Inner element gap (compact) | `gap-2` (8px) |
| Inner element gap (tight metadata row) | `gap-1.5` (6px) |

### 4.5 Section spacing

| Context | Spacing |
|---------|---------|
| Between sections on a scroll page | `space-y-6` (24px) or `space-y-8` (32px) for major breaks |
| Between cards in a list | `gap-3` (12px) |
| Between cards in a horizontal scroll | `gap-3 pr-4` (last card needs right padding to escape viewport) |
| Sticky CTA bar to bottom nav | sticky CTA sits above bottom nav at `bottom: calc(var(--height-bottom-nav-safe))` |

### 4.6 Radius scale

| Token | Value | Use |
|-------|-------|-----|
| `--radius-xs` | 4px | tiny chips, status dots |
| `--radius-sm` | 6px | small badges, tags |
| `--radius-md` | 8px | buttons (default), inputs |
| `--radius-lg` | 12px (existing `--radius`) | default card corners |
| `--radius-xl` | 16px | larger cards, hero image containers |
| `--radius-2xl` | 20px | premium cards, restaurant cards |
| `--radius-3xl` | 24px | bottom sheets, modals |
| `--radius-pill` | 9999px | chips, FABs, avatars, quantity steppers, pills |

**Convention:** cards = `rounded-2xl` (20px), buttons = `rounded-md` (8px) default / `rounded-full` for pill buttons, bottom sheets = `rounded-t-3xl` (24px top corners only).

---

## 5. COMPONENT SPECIFICATIONS

For each component: **Purpose · Anatomy · States · Mobile/Desktop · Motion · A11y**.

### 5.1 NAVIGATION

---

#### 5.1.1 Bottom navigation bar

**Purpose.** Primary navigation on mobile. Five tabs: **Home, Explore, Social, Orders, Rewards** (Profile is folded into Rewards or accessed via avatar in app bar — blueprint §7 lists `Rewards` and `Profile` as separate but we consolidate into a single "You" tab to keep the bar at 5 items max for thumb ergonomics).

Final tab order:
1. **Home** — Lucide `Home` icon
2. **Explore** — Lucide `Compass` icon
3. **Social** — Lucide `Users` icon (with violet dot when new activity)
4. **Orders** — Lucide `Receipt` icon (with badge count of active orders)
5. **You** — Avatar (profile photo) instead of icon, with reward ring around it showing progress to next tier

**Anatomy.**
- Container: full width, `height: var(--height-bottom-nav-safe)`, `bg-background` with top border `border-border`, `snak-glass` (subtle blur) when content scrolls underneath
- 5 equal-width tap regions, each 64px tall (extends below safe area)
- Each tab: icon (24px) above label (caption, 12px)
- Active indicator: 4px pill behind icon, `bg-primary/15` (teal-tinted), height 32px, width 56px, animated position with spring on tab change
- Active icon color: `text-primary` (teal-600)
- Inactive icon color: `text-muted-foreground`
- Active label weight: semibold; inactive: regular

**States.**
- Default — inactive styling
- Active — pill + colored icon + bold label
- Disabled (e.g., Social before login) — 40% opacity, no tap ripple
- Notification dot — small `bg-rose-500` 8px dot on top-right of icon (for new orders/social activity)
- Badge (count) — `bg-primary` pill with white number on top-right of icon, for active order count

**Mobile vs desktop.** Bottom nav hidden on `md+` screens; replaced by left sidebar nav (240px wide, fixed). On desktop the same icons + labels stack vertically.

**Motion.**
- Tab change: active pill slides horizontally with `spring.snappy` (stiffness 500, damping 30)
- Icon tap: `scale 0.92` press feedback, 100ms
- New-notification dot: `scale 0 → 1` with `spring.reward` (overshoot) + a single gentle pulse

**A11y.** Each tab is a `<button>` with `aria-current="page"` when active. Label is also `aria-label`. Tap target = 64px tall × viewport-5th wide (≥44px). Focus ring on the button, not the icon.

---

#### 5.1.2 Top app bar

**Purpose.** Sticky 56px header that orients the user — campus selector, search affordance, notifications, profile.

**Anatomy (mobile).**
- Left: campus selector chip — Lucide `MapPin` icon + campus name + chevron-down. Tapping opens campus selector bottom sheet.
- Center: search affordance — pill-shaped button "Search restaurants, dishes…" that opens full-screen search.
- Right: notification bell (Lucide `Bell`) with red dot if unread; profile avatar (32px circle, ring = reward tier color).

**Anatomy (desktop `md+`).** Stretches full width. Center search becomes a real inline input (max-w-md). Right cluster has more breathing room.

**States.**
- Default — solid `bg-background` with bottom border `border-border`
- Scrolled — switches to `snak-glass` (blur) once content scrolls under it (triggered via IntersectionObserver on a sentinel element OR scroll position > 8px)
- Campus-loading — chip shows shimmer
- Notification badge — red dot top-right of bell, 8px

**Motion.** Glass transition: 200ms ease-out background opacity. Bell dot pulse on new notification: 1.5s `snak-pulse-ring` once.

**A11y.** All controls are buttons with `aria-label`. Search affordance has `aria-haspopup="dialog"`. Campus selector has `aria-haspopup="dialog"`.

---

#### 5.1.3 Tab bar (sub-navigation)

**Purpose.** Horizontal pill tabs within a screen — e.g., "Open Now / Pickup in 10 / Deals" on Home; "All / Active / Past" on Orders.

**Anatomy.** Horizontal scrollable row of pill chips. Active chip = solid `bg-primary text-primary-foreground`. Inactive = `bg-muted text-muted-foreground`. Below the row, an animated underline (2px) tracks the active tab.

**States.**
- Default inactive
- Active (solid fill + animated underline)
- Hover (desktop only) — `bg-muted` light bump
- Disabled — 40% opacity

**Motion.** Active pill + underline: spring slide between tabs (stiffness 500, damping 30).

**A11y.** Wrap in `role="tablist"`. Each chip `role="tab"` with `aria-selected`.

---

### 5.2 CARDS

---

#### 5.2.1 Restaurant card

**Purpose.** Primary discovery surface. Answer "should I order from here?" in one glance.

**Anatomy.** Vertical card, `rounded-2xl`, `snak-card` shadow.
- Top: 4:3 hero image (cuisine gradient placeholder if no image). Overlay top-left: open/closed pill; overlay top-right: reward multiplier badge ("2× pts") using `--reward`.
- Body (`p-4`):
  - Row 1: Restaurant name (h3, font-semibold, truncate) + star rating (Lucide `Star` filled gold + number)
  - Row 2: cuisine tags (caption, muted) + dot + distance ("1.2 km") + dot + prep time ("15 min")
  - Row 3 (optional): popular item preview — small thumbnail (40px) + item name + price
  - Row 4 (optional): deal badge ("20% off first order") using `--success` background

**States.**
- Open — full color, full opacity
- Closed — desaturated hero (40% opacity), "Closed" pill in `bg-muted text-muted-foreground`, card still tappable to view menu (menu visible but items disabled)
- Loading — `snak-shimmer` on image + 3 skeleton lines
- Hover (desktop) — lift 2px, shadow deepens, hero image scales 1.03 (300ms ease-out)
- Pressed (mobile) — `scale 0.98`, 100ms

**Mobile vs desktop.**
- Mobile: single column, full width minus 32px page padding
- Tablet (`sm-md`): 2-column grid
- Desktop (`lg+`): 3-column grid

**Motion.** Card entrance: stagger up + fade (`y: 8, opacity: 0` → `y: 0, opacity: 1`, 30ms stagger, 280ms duration, ease-emphasized). Hover lift: `y: -2` + shadow grow.

**A11y.** Whole card is a single `<button>` (or `<a>` if navigates). Inner badges are `aria-hidden` (decorative). Star rating has `aria-label="Rated 4.5 out of 5"`. Image has alt text = restaurant name.

---

#### 5.2.2 Menu item card

**Purpose.** Single dish row in restaurant menu. Adds to cart in one tap.

**Anatomy.** Horizontal row, `p-3`, `rounded-xl`.
- Left: 80×80px image (`rounded-lg`, object-cover). Top-left of image: veg/non-veg badge (square with dot, green/red border — preserved from existing `bits.tsx`). Top-right of image: spice dots (1–3 dots, amber).
- Middle: name (body, font-medium) + description (small, muted, 2-line clamp) + price (mono, semibold) + reward points ("+12 pts" in gold-600, caption).
- Right: add button. Default state = `+` icon in a 36px teal-outlined circle. When quantity > 0 = quantity stepper (`-` [qty] `+`) in a teal-filled pill.

**States.**
- Default
- Added to cart (qty > 0) — quantity stepper replaces add button
- Sold out — image grayscale 100%, name strikethrough, "Sold out" badge in `bg-muted`
- Loading — skeleton image + 2 lines
- Hover (desktop) — subtle `bg-muted/50` background

**Mobile vs desktop.** Identical layout. On desktop, slightly larger image (96×96) and 3-line description clamp.

**Motion.**
- Add button → quantity stepper: spring swap (`scale 0.8 → 1` for the stepper, `spring.reward`)
- Quantity change: number scales 1.2 → 1 briefly (150ms)
- Add confetti micro-effect: tiny `+12 pts` floating up and fading (300ms) — only on first add of a session, not every increment

**A11y.** Whole row tappable to open item detail bottom sheet. Add button has `aria-label="Add [item name] to cart"`. Quantity stepper has `+`/`-` with proper labels. Veg badge has `aria-label="Vegetarian"`.

---

#### 5.2.3 Order card

**Purpose.** Appears in Orders tab and on Home "Quick reorder". Two variants: **Active** (in-progress) and **History** (completed).

**Active order card anatomy.** `rounded-2xl`, border-2 (border-teal-300 in light, border-teal-700 in dark).
- Header: status pill (animated, `snak-live-dot` for "Preparing"), restaurant name + thumbnail
- Body: items count ("3 items · ₹247"), pickup estimate ("Ready ~12:45 PM"), pickup OTP (mono, large)
- Footer: "Track order" primary button + "View QR" ghost button

**History order card anatomy.** `rounded-xl`, default border.
- Header: restaurant name + thumbnail + timestamp ("Yesterday, 2:15 PM")
- Body: items summary (truncated) + total
- Footer: "Reorder" primary-outline button + star rating prompt if unrated

**States.**
- Active — pulsing status pill
- Ready for pickup — border switches to `border-success-500`, status pill green with `snak-pulse-ring`, OTP visually emphasized
- Picked up — moves to history, static styling
- Cancelled — strikethrough total, "Cancelled" pill in `bg-danger-muted`
- Loading — skeleton

**Motion.** Status pill pulse continuous. On status change (e.g., PREPARING → READY), card does a subtle 80ms scale pulse + border color crossfade.

**A11y.** Status announced via `aria-live="polite"`. OTP is `aria-label="Pickup code [digits]"`.

---

#### 5.2.4 Reward progress card

**Purpose.** Persistent surface on Home and Rewards tab showing current points balance + progress to next tier.

**Anatomy.** `rounded-2xl`, `snak-gradient-reward` background (subtle), `p-5`.
- Left: SVG progress ring (80px diameter, 8px stroke). Ring fill = `--reward` gradient. Inside ring: points balance (mono, h2, bold) + "pts" caption.
- Right: tier name ("Gold tier"), points-to-next-tier ("340 pts to Platinum"), earn rate ("You earn 2× pts on every order").

**States.**
- Default — static ring at current progress
- Earning animation (on reward earned) — ring fills smoothly (600ms ease-out), number count-up animation (300ms), gold sparkle particles burst from ring center (3 particles, 600ms)
- Tier upgrade — full card flashes gold, "Tier upgraded!" toast slides down, ring resets to 0% with spring

**Motion.** Ring fill: stroke-dashoffset animated. Number count-up: framer-motion `useMotionValue` + `animate()`. Sparkle particles: 3 absolutely-positioned Lucide `Sparkles` icons scaling/fading outward.

**A11y.** Progress ring has `role="progressbar"` with `aria-valuenow` = current points, `aria-valuemax` = points to next tier. Text equivalent visible alongside.

---

#### 5.2.5 Gift card

**Purpose.** A food gift received from a friend. Appears on Home and Social tabs.

**Anatomy.** `rounded-2xl`, border-2 with violet-tinted border (`border-violet-300`).
- Top: gift item image (16:9 crop, `rounded-t-2xl`)
- Body:
  - Sender row: avatar (32px, ring violet-500) + "From [name]" + timestamp
  - Message: italic quote, body text, 3-line clamp
  - Item: name + restaurant + price (the gift's value)
- Footer: "Redeem gift" primary-violet button + expiry countdown ("Expires in 4h 12m", caption, warning if < 2h)

**States.**
- Received (unredeemed) — full styling, redeem button active
- Redeemed — "Redeemed ✓" success pill, card border fades to muted
- Expired — grayscale, "Expired" danger pill, redeem button disabled
- Expiring soon (< 2h) — countdown turns warning color, gentle pulse on countdown

**Motion.**
- New gift received: card slides in from top with `spring.reward` + violet sparkle burst
- Redeem: button press → gift box icon opens (Lucide `Gift` rotates 15° + sparkle particles) → card fades to redeemed state

**A11y.** Countdown is `aria-live="polite"` only when expiring soon (avoid noise). Redeem button has clear label.

---

#### 5.2.6 Group order bubble

**Purpose.** A friend-hosted group order you can join. Appears on Home "Group orders" section and Social feed.

**Anatomy.** Horizontal pill-shaped card, `rounded-full` or `rounded-2xl` (depending on density).
- Left: avatar stack — host avatar (32px) + up to 3 member avatars overlapping (-8px offset each) + "+N more" chip if > 4
- Middle: "[Host] is ordering from [Restaurant]" + member count ("4 friends joining") + cart status ("Cart filling" / "Ready to checkout")
- Right: "Join" button (rose gradient, pill) + status dot (rose pulse = "join now", muted = "locked at checkout")

**States.**
- Open — join button active, rose pulse dot
- Joined — your avatar appears in stack, button becomes "Leave" ghost button
- Locked (host at checkout) — join button disabled, "Locked" pill
- Closed (order placed) — bubble fades, "Order placed ✓" success pill

**Motion.**
- New member joins: avatar slides into stack from right (spring.snappy), bubble expands slightly
- Pulse dot: `snak-pulse-ring` with rose color

**A11y.** Join button `aria-label="Join [host]'s group order at [restaurant]"`.

---

#### 5.2.7 Social feed card

**Purpose.** Venmo-style activity — see what friends ordered (NO payment amounts). Blueprint §6 P2.

**Anatomy.** `rounded-xl`, `p-4`, default card surface.
- Top row: avatar (36px, ring violet-300) + name (semibold) + verb ("ordered from" / "redeemed a reward at" / "received a gift from") + timestamp (right-aligned, caption)
- Body: restaurant thumbnail (60×60, `rounded-lg`) + restaurant name + dish name (1 line)
- Optional: image carousel if multi-item (horizontal scroll of 3 thumbnails)
- Bottom row: like button (Lucide `Heart`, count) + comment button (Lucide `MessageCircle`, count)
- Mutual friends row (caption): "Liked by [friend] and 12 others"

**States.**
- Default
- Liked — heart fills violet, count increments with spring scale
- Comments expanded — slides down to show inline comments
- Loading — skeleton

**Motion.**
- Like tap: heart scales 1 → 1.3 → 1 (spring.reward overshoot), violet fill
- New feed card entrance: stagger up + fade

**A11y.** Like button `aria-pressed`. Comment count is announced. Card as a whole is a button to view restaurant.

---

### 5.3 FORMS & INPUTS

---

#### 5.3.1 Phone OTP login (refined)

**Purpose.** Primary auth. Phone → OTP → done.

**Anatomy.**
- Step 1 (phone): country code dropdown (+91 default), phone input (large, mono digits), "Send OTP" primary button. Below: "By continuing you agree to…" link.
- Step 2 (OTP): 6-digit OTP input (input-otp library already installed). Above: "Enter the code sent to +91 …" + change number link. Below: **demo code display** in a dashed box ("Demo code: 4242") for non-production environments, and **resend timer** ("Resend in 0:42") with disabled state, becoming "Resend code" link when timer hits 0.

**States.**
- Phone invalid — red border + helper text "Enter a valid 10-digit number"
- Sending — button shows spinner + "Sending…"
- OTP incorrect — input shakes (spring), border red, helper text "Incorrect code. Try again."
- OTP correct — green check + auto-advance to next screen
- Resend available — link enabled, no timer
- Resend cooling down — disabled countdown
- Demo environment — demo code visible (production: hidden). UX quality gate §45: "no demo credentials displayed in production UI"

**Motion.**
- Step 1 → Step 2 transition: slide left + fade (250ms ease-out)
- OTP correct: each digit fills with spring scale, then a green check scales in
- OTP wrong: input shakes horizontally (translateX ±4px, 3 oscillations, spring)

**A11y.** Phone input `aria-label="Phone number"`. OTP input has `aria-label="One-time code" autocomplete="one-time-code"`. Error messages `aria-live="assertive"`. Resend timer is `aria-live="polite"`.

---

#### 5.3.2 Campus selector

**Purpose.** Onboarding step + accessible from app bar chip.

**Anatomy (bottom sheet).**
- Header: "Select your campus" + close button
- Search input (with Lucide `Search` icon left)
- "Use current location" button (Lucide `MapPin` icon) — uses geolocation to find nearby campuses
- List of campuses: each row = campus logo (32px) + name + city/state + distance ("2.1 km away")
- Divider
- "Have an org code?" link → reveals org code input

**States.**
- Loading campuses — skeleton rows
- Empty search — "No campus matches '[query]'" + suggestion to enter org code
- Geolocation denied — "Allow location access to find nearby campuses"
- Org code entered — validates live, green check on valid, red on invalid

**Motion.** Bottom sheet: slide up from bottom (vaul library already installed). Row tap: row compresses 0.98, then sheet slides down on selection.

**A11y.** Each campus row is a button. Search input labeled. Org code input has helper text.

---

#### 5.3.3 Cart line item

**Purpose.** One row per item in cart.

**Anatomy.**
- Left: 56×56 image (`rounded-lg`)
- Middle: item name + modifiers summary (e.g., "Extra cheese, No onions" — small, muted) + price (line-through original if discounted, then discounted price in mono)
- Right: quantity stepper (`-` qty `+`, teal-filled pill) + line total below
- Swipe-left (mobile gesture): reveals red "Remove" action

**States.**
- Default
- Modifier note (e.g., "Medium spice") — small chip below name
- Out of stock — strikethrough, "Unavailable" pill, stepper disabled
- Removing — row collapses (height 0, opacity 0, 200ms)

**Motion.**
- Quantity change: row total animates (count-up if increasing)
- Remove: row height collapses with spring, neighbors slide up
- Add back via undo toast: row re-expands

**A11y.** Quantity stepper labels. Remove action has confirmation via swipe gesture (with undo toast instead of confirm dialog).

---

#### 5.3.4 Checkout form

**Purpose.** Final step before payment. Pickup name, phone, note, payment method.

**Anatomy.**
- Pickup name input (auto-filled from profile, editable)
- Phone input (auto-filled, editable, validated)
- Note to restaurant (optional textarea, "e.g., less spicy, no onions" placeholder, 100 char limit with counter)
- Payment method selector (radio cards):
  - **UPI** — icon (GPay/PhonePe/Paytm variants as smaller pills under the main UPI option) — recommended, marked "Popular"
  - **Card** — credit/debit card icon
  - **Razorpay** — Razorpay wallet / netbanking
  - **Rewards** — apply points slider (if balance > 0)
- Pickup time selector: "ASAP (15 min)" / "Schedule for later"

**States.**
- Default
- Field error — red border + helper text
- Payment method selected — radio card lifts + colored border
- Rewards slider — slider with current points balance, "Apply X pts = ₹Y off" live calculation, max = points balance
- Submitting — button shows spinner

**Motion.** Payment method radio selection: 200ms border + shadow transition. Rewards slider: value changes animate the "₹Y off" number count-up.

**A11y.** All inputs labeled. Radio group `role="radiogroup"`. Slider has `aria-valuemin/max/now` + text equivalent.

---

#### 5.3.5 Reward redemption selector

**Purpose.** In cart or checkout — apply earned points as discount.

**Anatomy.** Slider component (`@radix-ui/react-slider` already installed via shadcn `slider.tsx`).
- Top: "Your points: [balance]"
- Slider: 0 → balance, with marks at 25/50/75/100%
- Live calculation: "[X] pts = ₹[Y] off"
- Final total updates live

**States.**
- No points balance — collapsed, "Earn points on this order to redeem next time"
- Points < min redeemable (e.g., 50 pts) — slider disabled, "Need 50+ pts to redeem"
- Active — slider enabled
- Max applied — slider thumb at right, "Max redeem applied"

**Motion.** Slider thumb has spring on release. Number animations on value change.

**A11y.** Slider has proper ARIA. Text equivalent visible.

---

#### 5.3.6 Gift compose

**Purpose.** Send a food gift to a friend. Bottom sheet.

**Anatomy (bottom sheet, multi-step).**
- Step 1: friend picker — search + recent friends list (avatars + names) + "Send to anyone" (phone number input)
- Step 2: item picker — restaurant selector → menu → pick item
- Step 3: message — textarea ("Happy birthday! Enjoy 🎂") + gift wrap preview + send button

**States.**
- Friend selected — highlighted with violet border
- Item selected — preview card with image
- Message optional — placeholder shown
- Sending — button spinner
- Sent — sheet dismisses with gift-fly-away animation

**Motion.** Step transitions slide horizontally. Send action: gift box icon flies up off-screen with sparkle trail.

**A11y.** Each step labeled. Friend picker has search.

---

### 5.4 FEEDBACK

---

#### 5.4.1 Toast (sonner — already installed)

**Purpose.** Transient feedback for actions.

**Variants:**
- **Success** — emerald accent left border, Lucide `CheckCircle` icon
- **Error** — danger accent left border, Lucide `AlertCircle` icon
- **Info** — teal accent left border, Lucide `Info` icon
- **Reward earned (special)** — gold gradient background, Lucide `Sparkles` icon + sparkle particles burst + number count-up ("+24 pts earned")
- **Gift received** — violet accent, Lucide `Gift` icon
- **Group joined** — rose accent, Lucide `Users` icon

**Anatomy.** Top of viewport (mobile) or bottom-right (desktop). 320px wide on mobile (full width minus 16px padding). Card with `snak-card` shadow, `rounded-xl`, `p-3`. Icon left, content middle, close button right (auto-dismiss after 4s, 6s for reward).

**States.**
- Entering — slide down from top + spring bounce (mobile) / slide up from bottom-right (desktop)
- Visible — auto-dismiss timer
- Hover (desktop) — pauses auto-dismiss timer
- Dismissing — slide up + fade (200ms)
- Action button inside toast (e.g., "View order") — text button right-aligned

**Motion.** Entrance: `y: -100, opacity: 0` → `y: 0, opacity: 1` with `spring.reward`. Exit: `y: -20, opacity: 0` ease-in 200ms. Reward variant: extra sparkle particles burst (3 particles, 600ms).

**A11y.** `role="status"` for success/info/reward. `role="alert"` for error. `aria-live` polite (assertive for error).

---

#### 5.4.2 Skeleton loaders

**Purpose.** Show during data fetch. NEVER blank screens (UX quality gate §45: "no broken loading states").

**Per-component skeletons:**
- **Restaurant card skeleton** — `snak-shimmer` on 4:3 hero block + 3 lines (40%, 70%, 50% width)
- **Menu item skeleton** — 80×80 square + 2 lines + small chip
- **Order card skeleton** — header row + 3 lines + button block
- **Social feed skeleton** — avatar circle + 2 lines + 60×60 square
- **Reward ring skeleton** — 80px circle with `snak-shimmer` + 2 lines beside

**Motion.** Shimmer uses the `snak-shimmer` utility class (defined in tokens file) — left-to-right gradient sweep, 1.6s loop, ease-standard.

**A11y.** Skeletons have `aria-hidden="true"`. The container has `role="status" aria-label="Loading"`.

---

#### 5.4.3 Empty states

**Purpose.** Never show a blank screen with no explanation (UX quality gate §45).

**Anatomy (universal).**
- Illustration or icon (Lucide 64px, in a soft circular `bg-muted` backdrop, 120px diameter)
- Title (h3, font-semibold)
- Description (body, muted, max 2 lines)
- Primary CTA button (filled or outline depending on action priority)
- Secondary link (optional)

**Specific empty states:**
- **No restaurants** — icon `Store`, "No restaurants near this campus yet", CTA "Switch campus" + "Browse all"
- **No orders** — icon `Receipt`, "No orders yet", "Your past orders will appear here", CTA "Browse restaurants"
- **No friends (social)** — icon `Users`, "No friends yet", "Add friends to see what they're ordering", CTA "Find friends" + "Invite via link"
- **No rewards** — icon `Sparkles`, "No rewards yet", "Earn points on every order", CTA "Browse restaurants"
- **No search results** — icon `SearchX`, "No matches for '[query]'", "Try a different dish or restaurant", CTA "Clear filters"
- **No notifications** — icon `BellOff`, "You're all caught up", "New activity will show up here"

**Motion.** Icon + content fade up with stagger (icon first, then text, then button).

**A11y.** Container has `role="region" aria-label="[title]"`.

---

#### 5.4.4 Error states

**Three error categories:**

1. **Network error** (no internet / server unreachable)
   - Full-screen error card with icon `WifiOff`, "You're offline", "Check your connection and try again", "Retry" button
   - Toast on first detection: "Network connection lost"

2. **Auth error** (session expired / unauthorized)
   - Modal: "Your session expired", "Please sign in again to continue", "Sign in" button (clears session, routes to login)
   - Never silent — user always knows why they were logged out

3. **Validation error** (form field)
   - Inline: red border on input + helper text below (red, small)
   - Toast on submit attempt with errors: "Please fix the highlighted fields"
   - Field-level `aria-invalid="true"`

4. **API error** (server returned 4xx/5xx)
   - Inline retry pattern: "Couldn't load [content]", "Try again" button
   - Never auto-retry silently — user controls retry

**Motion.** Error entrance: shake on form fields (3 oscillations). Modal: scale + fade in.

**A11y.** Error messages `aria-live="assertive"`. Form fields `aria-invalid` + `aria-describedby` pointing to error id.

---

#### 5.4.5 Loading spinners (per-context)

**Purpose.** Inline loading where skeleton is overkill (button submit, small refresh).

**Variants:**
- **Button spinner** — Lucide `Loader2` icon, `animate-spin`, 16px, replaces button label
- **Inline list refresh** — pull-to-refresh on mobile (custom); on desktop, top-of-list thin teal progress bar
- **Full-page transition** — centered teal spinner (32px) + "Loading…" caption
- **Image lazy load** — `bg-muted` placeholder with `snak-shimmer` until image loads

NEVER use a spinner where a skeleton fits — skeletons communicate shape and reduce perceived wait. Spinners are for **actions** (submit, refresh, retry).

---

### 5.5 OVERLAYS

---

#### 5.5.1 Bottom sheet (vaul — already installed)

**Purpose.** Mobile-primary modal alternative. Used for: cart, filters, item details, gift compose, campus selector.

**Anatomy.**
- Backdrop: `bg-black/40 backdrop-blur-sm`
- Sheet: `bg-background`, `rounded-t-3xl`, `p-5`, max-height 90vh, scrollable
- Top: drag handle (40px wide, 4px tall, `bg-muted-foreground/30`, centered) — drag down to dismiss
- Header (sticky inside sheet): title + close button
- Body: scrollable content
- Footer (optional sticky): primary CTA button (full width)

**Snap points:** vaul supports snap — typical config: `[0.5, 0.9]` (half-expanded for quick action, full for detail).

**States.**
- Hidden — `display: none`
- Entering — slide up from `y: 100%` with `spring.gentle` (stiffness 320, damping 30)
- Visible — drag handle visible, backdrop dimmed
- Dragging — sheet follows finger, backdrop opacity scales with drag distance
- Dismissing — slide down + fade

**Mobile vs desktop.** On `md+` screens, sheets can either (a) become centered modals (recommended for forms) or (b) become right-side drawers (for filters/sort). Decision per use case documented in component spec.

**Motion.** Drag handle responds to drag — scales wider as user drags down. Backdrop opacity: `1 → 0.4` as drag approaches dismiss threshold.

**A11y.** `role="dialog" aria-modal="true"`. Focus trap. ESC closes. Focus restored to trigger on close.

---

#### 5.5.2 Modal (confirmation)

**Purpose.** Critical confirmations only — cancel order, delete payment method, leave group order. NOT for forms or details (those are sheets).

**Anatomy.** Centered card, 360px wide (mobile: full width minus 32px padding).
- Header: title (h3) + optional icon
- Body: description + warning callout if relevant
- Footer: cancel (ghost) + confirm (danger) buttons, side-by-side on desktop, stacked on mobile

**States.** Default, loading (confirm button shows spinner), error (inline message).

**Motion.** Backdrop fade 200ms. Card scale 0.95 → 1 with spring.gentle. ESC closes.

**A11y.** `role="alertdialog"`. Confirm button has clear destructive label ("Cancel order", not "OK"). Focus initially on confirm button only if action is reversible; otherwise on cancel.

---

#### 5.5.3 Tooltip

**Purpose.** Info hints on icons. Already available via shadcn `tooltip.tsx`.

**Anatomy.** Small dark pill (`bg-foreground text-background`, `rounded-md`, `px-2 py-1`, caption text). Appears 200ms after hover (desktop) or long-press (mobile). Auto-dismisses after 4s or on tap-away.

**States.** Hidden, visible, dismissing.

**Motion.** Fade + slight scale-up (0.95 → 1) + slide toward content (4px).

**A11y.** `role="tooltip"`. Trigger has `aria-describedby` pointing to tooltip. Never contains critical info — only helpful hints.

---

#### 5.5.4 Popover (filters, sort)

**Purpose.** Filter / sort options. Already via shadcn `popover.tsx`.

**Anatomy.** Card floats near trigger. Contains radio group / checkbox list / chips. Width 280–320px. Closes on outside tap or "Apply" button (depending on whether changes are live or batched).

**States.** Hidden, visible (with optional backdrop on mobile), applying.

**Motion.** Scale + fade in from trigger (150ms).

**A11y.** `role="dialog"`. Focus trap. ESC closes.

---

### 5.6 TIMELINE & PROGRESS

---

#### 5.6.1 Order tracking timeline (blueprint §15)

**Purpose.** Show order lifecycle visually. CRITICAL component — preserved and elevated from existing `order-tracking.tsx`.

**Status flow (canonical — blueprint §14):**
```
CREATED → PAYMENT_PENDING → PAYMENT_AUTHORIZED → PAYMENT_CAPTURED
       → ACCEPTED → PREPARING → READY_FOR_PICKUP → PICKED_UP
```
Existing simplified consumer flow uses: `CONFIRMED → PAID → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP` — preserve this for now (alignment with backend lifecycle handled in API layer).

**Anatomy (vertical timeline).**
- Container: card with hero header (`snak-gradient-primary` background) showing order #, restaurant name, current status badge
- Timeline: vertical list, each step = icon circle (32px) + step label + timestamp
- Connecting line between circles: emerald-400 if both steps done, muted otherwise
- Active step: circle has `snak-live-dot` pulse, label uses `text-primary`
- Done steps: emerald-500 filled circle with checkmark, muted timestamp
- Future steps: muted circle, muted label

**States.**
- In-progress — active step pulsing
- Ready for pickup — final actionable step highlighted with `snak-pulse-ring` (green), OTP visually emphasized
- Picked up — all steps done, no pulse, success summary

**Motion.**
- Step completion: circle fills with color (300ms), checkmark scales in (spring)
- Active step transitions: previous step completes animation, next step's pulse begins
- "Order is ready!" → entire card does a single celebratory pulse + sparkle particles burst from the READY_FOR_PICKUP circle

**Mobile vs desktop.** Same vertical layout. On desktop, can pair with a horizontal progress bar at top showing % complete.

**A11y.** Timeline announced as ordered list. Status changes via `aria-live="polite"` on a status summary region. Each step has `aria-current="step"` when active.

---

#### 5.6.2 Reward progress ring

**Purpose.** Circular progress to next reward tier. Used in reward card (5.2.4) and rewards tab header.

**Anatomy.** SVG circle (80px default, 120px on rewards tab). Stroke 8px. Background track = `bg-muted` (full circle, 8% opacity). Foreground arc = `snak-gradient-reward` (gold gradient). Inside: points balance (large mono number) + "pts" caption.

**States.**
- Static — at current progress
- Earning — arc extends smoothly (600ms ease-out), number count-up
- Tier reached — arc completes 360°, sparkles, then resets to 0 for new tier (spring)

**Motion.** stroke-dashoffset animation. Count-up via framer-motion `useMotionValue` + `animate()`.

**A11y.** `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`. Text equivalent visible (the number itself).

---

#### 5.6.3 Group order progress

**Purpose.** Show how full a group cart is (cart fill %), and who has joined.

**Anatomy.**
- Avatar stack (host + members, see 5.2.6)
- Cart fill indicator: horizontal bar (60px wide, 6px tall, `rounded-full`). Track = `bg-muted`. Fill = `snak-gradient-group` (rose). Width = (total items / target items) × 100%.
- Status text: "4 of 6 items added" or "Cart ready — checkout now"

**States.**
- Filling — bar grows on each item add (spring)
- Ready — bar full, status turns success emerald
- Locked at checkout — bar dim, "Locked at checkout" pill

**Motion.** Bar width animates with spring.snappy. New member join: avatar slides into stack with spring.

**A11y.** `role="progressbar"` with `aria-valuenow`/`aria-valuemax`.

---

### 5.7 QR & PICKUP

---

#### 5.7.1 Pickup QR display (consumer)

**Purpose.** Core product feature (blueprint §16). Show at counter to verify pickup.

**Anatomy.**
- Card with hero header (status: "READY FOR PICKUP" with `snak-pulse-ring`)
- Large QR code (240×240, `qrcode.react` `QRCodeSVG`, level="M", includes value `snakzap:pickup:[orderId]:otp:[otp]`)
- QR is on a white background card with `rounded-2xl` and `snak-shadow-card` (even in dark mode — QR needs white bg for scanner reliability)
- Below QR: pickup OTP in large mono digits (`text-4xl tracking-[0.3em] font-bold text-primary`) — preserved from existing `order-tracking.tsx`
- Pickup instructions: "Show this code at the [restaurant] counter to collect your order."
- Restaurant name + address + estimated ready time
- Action buttons: "Share" (Lucide `Share2`), "I'm here" (notify restaurant), "Call restaurant"

**States.**
- Pre-ready — QR shown greyed with "Order not ready yet" overlay; OTP still visible (for early arrival)
- Ready — full color, pulse ring around card border
- Picked up — QR replaced with "Picked up ✓" success state + timestamp
- Expired — QR with "Expired" overlay, "Request new code" button

**Motion.** On "ready": card does celebratory pulse + green pulse-ring activates. On pickup: success state scales in with checkmark.

**A11y.** QR has `aria-label="Pickup QR code for order [id]"`. OTP announced. Share button labeled.

---

#### 5.7.2 Vendor pickup scanner UI

**Purpose.** Vendor scans consumer's QR or enters OTP manually.

**Anatomy.**
- Camera viewport (full screen on mobile vendor tablet, or modal on desktop)
- QR scan target overlay (corners only, animated subtle pulse)
- Below viewport: "Or enter OTP manually" — 6-digit OTP input + "Verify" button
- Last scanned order summary (if any)

**States.**
- Idle (camera on, scanning)
- Scanning — yellow corner pulse
- Success — green flash + success sound + order summary card
- Already-picked-up error — red flash + "Order already picked up" error card + "View details" link
- Invalid QR — red flash + "Invalid pickup code" + try again
- Camera permission denied — fallback to manual OTP only

**Motion.** Scan target pulse continuous. Success/fail: viewport edge color flash (200ms).

**A11y.** Manual OTP path is the accessible fallback (camera may not work for screen reader users). All states announced.

---

### 5.8 BUTTONS

---

#### 5.8.1 Primary (teal gradient)

**Anatomy.** `bg-gradient-to-br from-teal-500 to-emerald-600 text-white font-semibold rounded-md px-5 py-3`. Default shadow `snak-shadow-card`. On hover: shadow deepens, gradient brightens slightly (brightness 1.05).

**States.**
- Default
- Hover (desktop) — brightness 1.05, shadow grows
- Pressed — `scale 0.98`, 100ms
- Disabled — 50% opacity, no shadow, no pointer
- Loading — spinner replaces label, button non-interactive

**Sizes:**
- `sm` — `px-4 py-2 text-sm` (32px height)
- `md` — `px-5 py-3` (40px height, default)
- `lg` — `px-6 py-3.5 text-base` (48px height, hero CTAs only)

**Motion.** Press: `scale 0.98` 100ms ease-out. Hover: 200ms ease-out shadow + brightness.

---

#### 5.8.2 Secondary (outline)

**Anatomy.** `bg-transparent border border-border text-foreground font-medium rounded-md px-5 py-3`. Hover: `bg-muted`.

---

#### 5.8.3 Ghost

**Anatomy.** `bg-transparent text-foreground hover:bg-muted font-medium rounded-md px-4 py-2`. For low-priority actions, secondary CTAs.

---

#### 5.8.4 Danger (red)

**Anatomy.** `bg-danger-500 text-danger-foreground font-semibold rounded-md px-5 py-3`. Hover: `bg-danger-600`. For cancel order, delete, destructive.

---

#### 5.8.5 Reward (amber)

**Anatomy.** `snak-gradient-reward text-reward-foreground font-semibold rounded-md px-5 py-3`. For "Redeem reward", "Apply points", "Claim gift".

---

#### 5.8.6 Social (violet)

**Anatomy.** `snak-gradient-social text-social-foreground font-semibold rounded-md px-5 py-3`. For "Send gift", "Add friend", "Follow".

---

#### 5.8.7 Group (rose)

**Anatomy.** `snak-gradient-group text-group-foreground font-semibold rounded-md px-5 py-3`. For "Join group order", "Start group order".

---

#### 5.8.8 Icon buttons

**Anatomy.** 40×40 (min touch target), `rounded-full`, transparent bg, icon 20px. Hover: `bg-muted`. Active: `scale 0.92`. Variants: ghost (default), outline (`border border-border`), filled (`bg-primary text-primary-foreground`).

---

#### 5.8.9 FAB (Floating Action Button)

**Purpose.** Primary contextual action — e.g., "View cart (3)" sticky above bottom nav, "Start group order" on Home.

**Anatomy.** 56×56 circle, `snak-shadow-fab`, `snak-gradient-primary`. Optional label pill extension ("View cart · 3"). Position: `fixed bottom-[calc(var(--height-bottom-nav-safe)+16px)] right-4`.

**States.**
- Default
- With badge — count pill on top-right
- Extended (with label) — pill shape, `rounded-full px-5`
- Hidden — `scale 0` when no action available

**Motion.** Appear: spring.scale with `spring.snappy`. Tap: `scale 0.9`. Hide: scale to 0.

---

#### 5.8.10 Sticky CTA bar

**Purpose.** Persistent action at bottom of a scroll view (e.g., checkout "Place order ₹247", cart "View cart").

**Anatomy.** Full-width bar, `bg-background` with top border + `snak-shadow-popover`, `p-4`, sits above bottom nav at `bottom: var(--height-bottom-nav-safe)`.

Contents: left side = summary (price, item count), right side = primary button. Optional: left icon button (back, edit).

**States.** Default visible. Slide down + fade when scrolled out of relevant context. Slide up + fade when entering.

**Motion.** Slide up on enter (`y: 100% → 0`, spring.gentle). Slide down on exit (`y: 0 → 100%`, ease-in 200ms).

**A11y.** Stays in tab order. Button is full primary.

---

## 6. MOTION LANGUAGE

### 6.1 Token reference

All durations, easings, and spring presets are in `src/app/design-tokens.css` under the `/* Motion tokens */` section. Use them via CSS variables OR mirror them as framer-motion `transition` objects in code.

### 6.2 Standard motion patterns

| Pattern | Tokens | When |
|---------|--------|------|
| **Card entrance** | `duration-base` (220ms) + `ease-emphasized`, stagger 30ms | Lists mount |
| **Page transition (forward)** | `duration-slow` (320ms) + `ease-emphasized`, slide from right | Navigate deeper |
| **Page transition (tab)** | `duration-base` + `ease-standard`, fade only | Switch bottom-nav tab |
| **Button press** | `duration-instant` (80ms) + `ease-out`, `scale: 0.98` | Tap |
| **Hover lift** | `duration-base` + `ease-out`, `y: -2` + shadow grow | Desktop hover |
| **Bottom sheet enter** | `spring.gentle` (stiffness 320, damping 30, mass 1) | Sheet open |
| **Toast enter** | `spring.reward` (stiffness 180, damping 14, mass 1) | Toast appears |
| **Toast exit** | `duration-fast` (150ms) + `ease-in`, `y: -20, opacity: 0` | Toast dismiss |
| **Reward earn** | `spring.reward` + sparkle particles (3, 600ms) + count-up (300ms) | Points earned |
| **Gift send** | Gift icon flies `y: -200, opacity: 0, scale: 0.5` + sparkle trail | Gift sent |
| **Skeleton shimmer** | 1.6s loop, `ease-standard` | Loading |
| **Active pulse** | 1.6s loop, opacity 1 → 0.45 → 1 | Live status |
| **Pulse ring** | 1.8s loop, box-shadow 0 → 12px → 0 | Ready-for-pickup |
| **Sparkle** | 1.8s loop, opacity 0.55 → 1 → 0.55, scale 1 → 1.08 → 1 | Reward-earned toast |

### 6.3 Page transition implementation

App Router pages: wrap content in `<motion.div>` with `initial`, `animate`, `exit` using `AnimatePresence` at layout level. Tab switches: fade only (no slide — feels like a tab, not a navigation). Stack pushes: slide from right.

### 6.4 Stagger pattern

```ts
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03, delayChildren: 0.05 } }
}
const item = {
  hidden: { y: 8, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.28, ease: [0.3, 0, 0, 1] } }
}
```

### 6.5 Reduced motion

**Always honor `prefers-reduced-motion`.** Use framer-motion's `useReducedMotion()` hook to disable transforms and spring physics. Replace with instant opacity transitions. The tokens file's `@media (prefers-reduced-motion: reduce)` block disables all `snak-*` keyframe animations as a safety net for non-framer animations.

---

## 7. ICONOGRAPHY

### 7.1 Lucide icons (primary set)

Already installed via `lucide-react`. Standard icon size: 20px (UI), 16px (inline with text), 24px (bottom nav), 32px+ (empty states).

**Common icon assignments:**
- Home → `Home`
- Explore → `Compass`
- Social → `Users`
- Orders → `Receipt`
- Rewards → `Sparkles` or `Award`
- Cart → `ShoppingCart`
- Search → `Search`
- Location → `MapPin`
- Time → `Clock`
- Star (rating) → `Star` (filled)
- Veg badge → custom SVG (existing `bits.tsx`)
- Pickup QR → `QrCode`
- Gift → `Gift`
- Group → `Users`
- Phone → `Phone`
- Bell → `Bell`
- Filter → `SlidersHorizontal`
- Sort → `ArrowUpDown`

### 7.2 Custom SVGs needed

| Icon | Purpose | Notes |
|------|---------|-------|
| Reward coin | Points balance, reward ring center | Gold gradient circle with "Z" or ₹ embossed |
| Gift box | Gift cards, gift-send CTA | Closed box with violet ribbon (animated open variant) |
| Group bubble | Group order indicator | Three overlapping circles, rose tinted |
| Campus pin | Campus selector | MapPin variant with campus building silhouette inside |
| Pickup handoff | Pickup QR / vendor scanner | Hand-offering-box icon, teal |
| Veg/non-veg dot | Menu items | Existing — square with center dot, green/red border |

These can be inline SVG components in `src/components/snak/icons.tsx`. Keep stroke-width consistent with Lucide (2px default, 1.5px for fine details).

### 7.3 Emoji usage policy

**Sparingly, for warmth.** Permitted contexts:
- Order status steps (the existing `STATUS_META` uses emoji like ✓ — preserve)
- Gift message placeholders ("Happy birthday! 🎂")
- Celebration toasts ("🎉 Order placed!")
- Empty state microcopy ("You're all caught up ✨")

**Not permitted:**
- As primary icons in nav, cards, or buttons (use Lucide)
- As status indicators without text backup
- In headings (use real text + Lucide icon)

**Approved emoji:** ✓ ✨ 🎉 ⭐ 🔥 ⚡ 🎁 📱 🏪 🍴 (these render consistently across iOS/Android/web).

---

## 8. ACCESSIBILITY

### 8.1 Touch targets

**Minimum 44×44px** for every interactive element. Bottom nav tabs: 64px tall. Icon buttons: 40px (with 2px padding buffer to meet 44px effective area). Inline links in body text: minimum 32px tap target with `aria-label` if text is short.

### 8.2 Color contrast

- **Text on background:** AA 4.5:1 minimum (verified against teal-600 on white, gold-600 on gold-50, violet-600 on white — all pass)
- **Large text (h2+, 24px+):** AA 3:1 minimum
- **Icon-only buttons:** 3:1 minimum against surrounding surface
- **Disabled state:** exempt from contrast (per WCAG) but should still be visually distinct

The refined ramps in `design-tokens.css` were tuned for AA compliance. The light-mode `--primary` (teal-600) on `--background` (near-white) achieves ~5.8:1. Dark-mode `--primary` (teal-500) on dark background achieves ~5.2:1.

### 8.3 Focus rings

**Visible, brand-tinted, never removed.** Use the `.snak-focus-ring` utility class which provides `outline: 2px solid var(--ring); outline-offset: 2px`. Never `outline: none` without replacement.

For keyboard navigation: focus order matches visual order. Modal/dialog: focus trap inside, restore focus to trigger on close.

### 8.4 Screen reader labels

- Every icon-only button: `aria-label`
- Every image: `alt` text (decorative images: `alt=""`)
- Status changes (order status, reward earned): `aria-live="polite"` region
- Errors: `aria-live="assertive"` + `aria-invalid` on fields
- Tabs: `role="tablist"`, `role="tab"`, `aria-selected`
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title

### 8.5 Reduced motion

- Honor `prefers-reduced-motion` via framer-motion `useReducedMotion()`
- All `snak-*` keyframe animations disabled in `@media (prefers-reduced-motion: reduce)` block in tokens file
- Replace transforms with opacity-only transitions
- Skeletons: keep shimmer (informational) OR switch to static muted background — recommend static for severe reduced-motion

### 8.6 Keyboard navigation

- All interactive elements reachable via Tab
- ESC closes overlays (sheets, modals, popovers)
- Enter/Space activates buttons
- Arrow keys navigate radio groups, tab lists, menus
- No keyboard traps except intentional ones (modal focus trap)

---

## 9. DARK MODE

### 9.1 Approach

- **next-themes is already installed and wired up** in `src/components/providers.tsx` (currently `defaultTheme="light"`, `enableSystem={false}`)
- Recommendation: change to `enableSystem={true}` with `defaultTheme="system"` OR keep `defaultTheme="light"` and add a manual toggle in the Profile/You screen + app bar
- Class strategy: `attribute="class"` (current setup) — toggles `.dark` on `<html>`
- All token ramps in `design-tokens.css` have explicit `.dark` overrides

### 9.2 Dark palette philosophy

- **Background** is not pure black — it's a deep teal-tinted neutral (`oklch(0.16 0.015 200)`) — slightly cooler than zinc, warmer than pure black. Matches existing globals.css.
- **Cards** are elevated dark (`oklch(0.21 0.02 200)`) — slightly lighter than background to create depth
- **Brand colors brighten** — primary teal shifts from 600 → 500, gold from 500 → 400, violet from 500 → 400. Vibrant gradients stay readable on dark.
- **Cuisine gradients stay vibrant** — we do NOT mute them. The whole point of cuisine gradients is warmth; muting them in dark mode would kill the food-app feel.
- **Borders use white-at-opacity** (`oklch(1 0 0 / 12%)`) instead of dark-on-light — feels softer than hard gray borders

### 9.3 Dark mode for key components

| Component | Dark mode treatment |
|-----------|---------------------|
| Restaurant card | Card surface darkens, cuisine gradient stays vibrant, hero image overlay adjusts |
| Menu item card | Same layout; veg badge border stays green/red, spice dots stay amber |
| Order tracking timeline | Done steps stay emerald-500 (brightened), active step teal-400, pulsing continues |
| Social feed | Avatars retain rings, violet accents pop more on dark |
| Pickup QR | QR stays on white card (scanner reliability); surrounding card darkens |
| Bottom nav | `snak-glass` blur effect more pronounced on dark — looks premium |
| Reward ring | Gold gradient shines brighter (gold-400 anchor) |

### 9.4 Dark mode toggle UX

- Toggle in You/Profile screen ("Appearance: Light / Dark / System")
- Optional: quick toggle in app bar (sun/moon icon) — hidden on mobile to save space, visible on desktop
- On first toggle: brief crossfade transition (200ms) — no jarring flash
- Respect `prefers-color-scheme` on first visit if `enableSystem={true}`

---

## 10. MOBILE-FIRST RESPONSIVE BREAKPOINTS

### 10.1 Breakpoint definitions (Tailwind defaults)

| Breakpoint | Min width | Target device |
|-----------|-----------|---------------|
| (default) | 0 | Mobile portrait — phone |
| `sm` | 640px | Mobile landscape / small tablet |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / small laptop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop |

### 10.2 Layout per breakpoint

**< 640px (mobile — primary design target):**
- Single column everywhere
- Bottom nav visible (64px + safe area)
- Bottom sheets for all overlays
- Sticky CTA bar above bottom nav
- App bar: 56px sticky
- Cards: full width minus 32px page padding (16px each side)
- Modals: full-screen except for tiny confirmations

**640–1024px (tablet):**
- 2-column grids for restaurant/menu lists
- Bottom nav still visible (tables are still held like phones)
- Sheets can become right-side drawers OR stay as bottom sheets (designer's call per use case)
- App bar gains inline search

**> 1024px (desktop):**
- 3-column grids (restaurant discovery)
- Bottom nav replaced by left sidebar (240px, fixed)
- Modals become centered dialogs (not sheets)
- App bar becomes full-width with expanded search

### 10.3 Content max-widths

- App shell: `max-w-md` (768px) centered — even on huge monitors, the app stays phone-shaped. This is a deliberate choice: SnakZap is a mobile-first product, and a 1200px-wide food app feels wrong.
- Long-form content (receipts, terms): `max-w-sm` (576px) for readability
- Image galleries: full bleed on mobile, `max-w-md` on desktop

### 10.4 Touch vs pointer

- All interactive elements must work with BOTH touch and mouse
- Hover states only apply on `hover: hover` media query (so touch devices don't get stuck hover)
- Long-press gestures on mobile map to right-click context menus on desktop (where relevant)
- Pull-to-refresh on mobile lists only (disabled on desktop)

---

## 11. PREMIUM POLISH CHECKLIST

A component is "premium-ready" when ALL of the following are true:

### 11.1 Visual polish
- [ ] Soft multi-layer shadow (`snak-shadow-card` / `snak-shadow-popover`) — never a single harsh drop-shadow
- [ ] Rounded corners match context: cards 2xl (20px), buttons md (8px), pills full
- [ ] Subtle border using `color-mix(in oklch, var(--border) 80%, transparent)` for soft edges
- [ ] Gradient meshes on hero sections (`snak-gradient-mesh` utility)
- [ ] Glassmorphism (`snak-glass`) on overlays and sticky bars — never on regular cards
- [ ] Cuisine gradients stay vibrant (no dark-mode muting)

### 11.2 Motion polish
- [ ] Every interactive element has a press feedback (`scale 0.98`)
- [ ] Every list has staggered entrance (cards fade up, 30ms stagger)
- [ ] Every state change has a transition (no instant snaps except for true toggles)
- [ ] Skeletons use `snak-shimmer` (shimmer, never spinner, for content loading)
- [ ] Reduced motion respected
- [ ] 60fps — only transform and opacity animated (never width/height/top/left)
- [ ] Spring physics for natural feel (`spring.gentle` for sheets, `spring.snappy` for taps, `spring.reward` for celebrations)

### 11.3 Interaction polish
- [ ] Every primary action has a clear CTA (primary button, sticky CTA bar, or FAB)
- [ ] Bottom sheets have drag-to-dismiss
- [ ] Lists have pull-to-refresh on mobile
- [ ] Long lists have infinite scroll or pagination with skeleton
- [ ] Empty states for every list (never blank)
- [ ] Error states for every async action (never silent failure)
- [ ] Loading states for every async action (never blank while waiting)

### 11.4 Information hierarchy
- [ ] One h1 max per screen (usually h2 on mobile)
- [ ] Display font reserved for hero numbers, not body
- [ ] Three text hierarchy levels max (foreground, muted-foreground, subtle/60)
- [ ] Numbers use mono for tabular alignment (prices, totals, OTP, points)
- [ ] INR currency uses `inr()` helper (existing in `lib/snack.ts`)

### 11.5 Accessibility polish
- [ ] All inputs labeled (visible or aria-label)
- [ ] All icon-only buttons have aria-label
- [ ] Focus rings visible and brand-tinted
- [ ] Touch targets ≥ 44×44
- [ ] Color contrast AA (text 4.5:1, large 3:1)
- [ ] Status changes announced (aria-live)
- [ ] Reduced motion respected

### 11.6 Mobile-specific polish
- [ ] Safe-area insets respected (top notch, bottom home indicator)
- [ ] Bottom nav height + safe area (`var(--height-bottom-nav-safe)`)
- [ ] Sticky CTA bars sit ABOVE bottom nav, not at viewport bottom
- [ ] No horizontal overflow (UX quality gate §45)
- [ ] Pull-to-refresh where appropriate
- [ ] Long-press for context actions where appropriate

### 11.7 Indian context polish
- [ ] INR currency everywhere (₹ symbol, Indian digit grouping via `Intl.NumberFormat('en-IN')`)
- [ ] Veg/non-veg badges on all menu items
- [ ] Spice level indicators (dots)
- [ ] Devanagari font fallback for Hindi text
- [ ] UPI as default payment method (marked "Popular")
- [ ] Phone numbers handle +91 default

---

## 12. IMPLEMENTATION NOTES

### 12.1 Token consumption patterns

In Tailwind 4 with `@theme inline`, all tokens become utility classes:
```tsx
// Color
<div className="bg-gold-500 text-violet-700 border-rose-300" />
<button className="bg-primary text-primary-foreground" />

// Semantic accent
<button className="bg-reward text-reward-foreground" />
<button className="bg-social text-social-foreground" />

// Typography (custom utilities — needs config or inline styles for size/line-height)
<h1 className="font-display text-h1 font-bold leading-tight" />
// Or use existing tailwind text-3xl/4xl with --font-display family:
<h1 className="font-display text-3xl font-bold leading-[1.15]" />

// Spacing (tailwind defaults align with --space-*)
<div className="p-4 gap-3 space-y-6" />

// Radius
<div className="rounded-2xl snak-card" />

// Shadows
<div className="shadow-[var(--snak-shadow-card)]" />
// Or use the .snak-card utility class which bundles shadow + border + radius

// Glass + gradient utilities (helper classes)
<div className="snak-glass" />
<div className="snak-gradient-mesh" />
<div className="snak-gradient-primary" />
```

### 12.2 Typography consumption

For display headings, add `font-display` class. The `--font-display-stack` includes Geist Sans as fallback so even if Plus Jakarta Sans isn't loaded yet, layout doesn't break.

To load Plus Jakarta Sans + Noto Sans Devanagari via `next/font/google` (recommended next step in `src/app/layout.tsx`):
```ts
import { Plus_Jakarta_Sans, Noto_Sans_Devanagari } from "next/font/google";
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"], weight: ["500","600","700"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"] });
// Add `${display.variable} ${deva.variable}` to <body> className
```

### 12.3 Motion consumption

For framer-motion transitions, reference tokens via CSS variables OR mirror in JS:
```ts
import { motion, useReducedMotion } from "framer-motion";

const prefersReduced = useReducedMotion();
const springGentle = { type: "spring", stiffness: 320, damping: 30, mass: 1 };

<motion.div
  initial={{ opacity: 0, y: prefersReduced ? 0 : 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={prefersReduced ? { duration: 0.15 } : { duration: 0.28, ease: [0.3, 0, 0, 1] }}
/>
```

### 12.4 Component library strategy

This design system is **specification-first, not library-first**. Each component described here will be implemented as a React component in `src/components/snak/` (existing directory) or `src/components/snak/ui/` (new subdirectory for design-system primitives).

Recommended structure:
- `src/components/snak/ui/button.tsx` — wraps shadcn Button with SnakZap variants (primary-gradient, reward, social, group)
- `src/components/snak/ui/card.tsx` — wraps shadcn Card with `.snak-card` defaults
- `src/components/snak/ui/bottom-nav.tsx` — new
- `src/components/snak/ui/app-bar.tsx` — new
- `src/components/snak/ui/restaurant-card.tsx` — new
- `src/components/snak/ui/menu-item-card.tsx` — new
- `src/components/snak/ui/order-card.tsx` — new
- `src/components/snak/ui/reward-ring.tsx` — new
- `src/components/snak/ui/order-timeline.tsx` — wrap existing
- `src/components/snak/ui/empty-state.tsx` — new
- `src/components/snak/ui/skeletons/*.tsx` — per-component skeletons
- `src/components/snak/icons.tsx` — custom SVG icons

shadcn primitives in `src/components/ui/` remain the base — SnakZap wrappers layer branding on top.

### 12.5 File map (this design system)

| File | Role | Status |
|------|------|--------|
| `src/app/globals.css` | shadcn base tokens (existing) | Unchanged |
| `src/app/design-tokens.css` | Brand ramps, semantic accents, typography, spacing, motion, utility classes | **NEW (this task)** |
| `src/app/layout.tsx` | Root layout (existing) | Add fonts in next task |
| `src/components/providers.tsx` | next-themes setup (existing) | Update theme defaults in next task |
| `src/components/ui/*` | shadcn primitives (existing) | Unchanged |
| `src/components/snak/*` | SnakZap components (existing consumer-view, order-tracking, etc.) | Elevate per this spec in next task |
| `DESIGN_SYSTEM.md` | This document | **NEW (this task)** |

### 12.6 Quality gate (UX §45)

Every component shipped against this spec must pass the UX Quality Gate from blueprint §45:
- No placeholder UI
- No demo credentials in production UI
- No fake success states
- No hardcoded order data
- No fake payment success
- No broken loading states
- No empty screen without explanation
- No dead buttons
- No unhandled API errors
- No horizontal overflow
- Mobile-first behavior
- Accessibility basics
- Clear confirmation after mutation

---

## 13. SUMMARY OF KEY DECISIONS

1. **Preserve teal/emerald primary** — refined the ramp anchor from existing #0D9488 to a full OKLCH 50–950 ramp with `teal-600` as the light-mode CTA and `teal-500` as the dark-mode CTA.
2. **Six accent systems, each semantic** — gold (rewards), violet (social), rose (group), red (danger), emerald (success), plus teal (info). Each has a full ramp + semantic single-step token + foreground + muted variants. No arbitrary colors.
3. **OKLCH color space throughout** — perceptually uniform, matches existing globals.css, allows precise dark-mode luminance tuning.
4. **Plus Jakarta Sans (display) + Geist Sans (body) + Noto Sans Devanagari (Hindi)** — premium warmth, Indian script support, existing Geist fonts preserved.
5. **Mobile-first, bottom-sheet oriented** — every overlay is a sheet on mobile by default; only critical confirmations are modals.
6. **Motion is subtle and consistent** — 6 spring/easing presets, stagger pattern for lists, count-up for rewards, sparkle particles for celebrations, shimmer (never spinners) for content loading.
7. **Premium = polish not complexity** — soft multi-layer shadows, generous radius (2xl for cards), glassmorphism surgically applied (overlays + sticky bars only), gradient meshes on hero sections only.
8. **Accessibility is non-negotiable** — 44px touch targets, AA contrast, visible focus rings, reduced-motion respected throughout.
9. **Dark mode is opt-in but complete** — full dark ramp for every brand color, cuisine gradients stay vibrant, glass effects more pronounced.
10. **Tokens file is self-contained and importable** — single `@import` line in globals.css activates everything; no breaking changes to existing shadcn tokens.

---

## APPENDIX A — TOKEN QUICK REFERENCE

### A.1 Semantic accent tokens (most-used)

| Token | Light value | Dark value | Tailwind utility |
|-------|------------|------------|-----------------|
| `--primary` | teal-600 | teal-500 | `bg-primary`, `text-primary` |
| `--reward` | gold-500 | gold-400 | `bg-reward`, `text-reward` |
| `--social` | violet-500 | violet-400 | `bg-social`, `text-social` |
| `--group` | rose-500 | rose-400 | `bg-group`, `text-group` |
| `--success-token` | success-500 | success-400 | `bg-success`, `text-success` |
| `--danger-token` | danger-500 | danger-400 | `bg-danger`, `text-danger` |
| `--warning` | amber-400-ish | (see tokens) | `bg-warning`, `text-warning` |
| `--info` | teal-500 | teal-400 | `bg-info`, `text-info` |

### A.2 Utility classes

| Class | Effect |
|-------|--------|
| `.snak-card` | Card surface: bg-card + rounded-2xl + soft shadow + subtle border |
| `.snak-glass` | Glassmorphism: blur + transparent bg |
| `.snak-gradient-primary` | Teal → emerald 135deg gradient |
| `.snak-gradient-reward` | Gold 3-stop gradient |
| `.snak-gradient-social` | Violet 2-stop gradient |
| `.snak-gradient-group` | Rose 2-stop gradient |
| `.snak-gradient-mesh` | Multi-color radial mesh for heroes |
| `.snak-shimmer` | Skeleton shimmer animation |
| `.snak-sparkle` | Sparkle pulse animation |
| `.snak-pulse-ring` | Expanding ring pulse (ready-for-pickup) |
| `.snak-live-dot` | Opacity pulse (existing in globals.css) |
| `.snak-focus-ring` | Accessible focus ring |
| `.snak-pad-bottom-safe` | Bottom safe-area padding |
| `.snak-pad-top-safe` | Top safe-area padding |
| `.snak-h-bottom-safe` | Bottom nav height + safe area |
| `.snak-h-top-safe` | App bar height + safe area |

### A.3 Motion presets (framer-motion)

| Name | Stiffness | Damping | Mass | Use |
|------|-----------|---------|------|-----|
| `spring.gentle` | 320 | 30 | 1 | Bottom sheets, page transitions |
| `spring.snappy` | 500 | 30 | 1 | Tab switches, FAB appears |
| `spring.reward` | 180 | 14 | 1 | Reward celebrations, toast entrance |

### A.4 Z-index layers

| Token | Value | Layer |
|-------|-------|-------|
| `--z-sticky` | 10 | Sticky headers, CTA bars |
| `--z-nav` | 20 | Bottom nav |
| `--z-sheet` | 30 | Bottom sheets |
| `--z-popover` | 40 | Popovers, dropdowns |
| `--z-modal` | 50 | Centered modals |
| `--z-toast` | 60 | Toasts |
| `--z-tooltip` | 70 | Tooltips |

---

**End of design system specification.**

Companion file: `src/app/design-tokens.css` — import once in `src/app/globals.css` after `@import "tailwindcss"` to activate all tokens and utility classes.

Next implementation task: build the SnakZap UI component primitives in `src/components/snak/ui/` per this spec, starting with Button variants, Card wrapper, Bottom Nav, App Bar, and the Restaurant Card (vertical slice #1 from blueprint §34 PHASE 2).
