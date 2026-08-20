# SNAKZAP — IDE MASTER IMPLEMENTATION BLUEPRINT
## Product, UX, Architecture, Governance, Execution & Evidence Specification

**Document Type:** Authoritative IDE implementation specification  
**Product:** Snakzap  
**Primary Concept:** Social food-ordering + order-ahead + pickup + rewards + gifting + group ordering  
**Primary Launch Context:** College campuses first, then local restaurants / campus-adjacent commerce  
**Reference Product:** Snackpass (feature benchmark, not a copy)  
**Implementation Principle:** Build the real customer-facing product while governance gates continue in parallel.

---

# 0. EXECUTIVE DIRECTIVE

The IDE must treat this document as the master product-development directive.

The previous project effort over-invested in backend governance, invariants, infrastructure and evidence gates while the actual customer-facing application remained thin.

That imbalance must now be corrected.

## Core rule

> **Build the product and governance together. Neither track blocks the other unless a real safety, security, data-integrity, payment, or production-risk dependency requires it.**

The IDE must NOT interpret this project as "finish infrastructure first and build UI later."

Instead:

```text
PRODUCT TRACK
Discovery → UX → Consumer → Vendor → Admin → Payments → Social → Rewards
                         ↓
                    End-to-End UX

GOVERNANCE TRACK
Security → invariants → audit → idempotency → RBAC → evidence gates
                         ↓
                    Production safety

INFRASTRUCTURE TRACK
Supabase → Vercel → Fly.io → Razorpay → GitHub → Observability
                         ↓
                    Deployment readiness
```

These tracks proceed in parallel.

---

# 1. PRODUCT VISION

Snakzap is a social food-ordering application designed primarily for college campuses and local restaurants.

The product should make food ordering:

- faster
- cheaper
- social
- rewarding
- predictable
- convenient
- campus-aware

The primary user promise:

> **Skip the line. Order ahead. Pick up fast. Earn rewards. Share food with friends.**

Secondary promise:

> **Turn ordinary food ordering into a social campus experience.**

---

# 2. PRODUCT POSITIONING

Snakzap should NOT be designed as a generic DoorDash clone.

The product wedge is:

```text
Campus + Local Food
       +
Order Ahead
       +
Pickup
       +
Social Graph
       +
Rewards
       +
Gifting
       +
Group Ordering
```

The strongest initial use case is NOT delivery.

The strongest initial use case is:

```text
Student sees restaurant
        ↓
Chooses food
        ↓
Orders before reaching counter
        ↓
Restaurant prepares
        ↓
Student receives ready notification
        ↓
Student scans pickup QR / verifies pickup
        ↓
Leaves immediately
        ↓
Earns rewards
        ↓
Can gift / reorder / share
```

---

# 3. PRODUCT BENCHMARK

Use Snackpass as a benchmark for product patterns such as:

- order-ahead
- rewards
- social food gifting
- group ordering
- social feed
- campus-centric discovery
- restaurant partner tooling

Do NOT copy proprietary UI, branding, text, visual identity, or implementation.

Snakzap should improve the model with:

- stronger pickup verification
- explicit payment-state separation
- stronger auditability
- governance-first payment architecture
- campus identity
- transparent fees
- merchant operational controls
- better group-order coordination
- stronger rewards fraud prevention
- gifting controls
- event-driven order lifecycle
- production evidence gates

---

# 4. TARGET USERS

## 4.1 Student / Consumer

Primary persona.

Needs:

- fast ordering
- low fees
- nearby food discovery
- predictable pickup
- rewards
- social interaction
- gifting
- group ordering
- order history
- easy repeat orders

## 4.2 Restaurant / Vendor

Needs:

- receive orders
- accept/reject orders
- configure preparation time
- manage menu
- mark items unavailable
- manage pricing
- manage promotions
- see sales
- manage staff
- manage pickup
- handle refunds / exceptions

## 4.3 Campus / Organization

Future persona.

Needs:

- campus-specific restaurants
- meal plans
- allowances
- sponsored credits
- student discounts
- reporting
- controlled merchant network

## 4.4 Admin / Operations

Needs:

- platform monitoring
- user management
- vendor management
- payment/reconciliation visibility
- fraud/risk controls
- feature flags
- audit logs
- support tools
- emergency kill switches

---

# 5. PRODUCT NORTH STAR

Primary North Star Metric:

> **Successful pickup orders per active campus user per week**

Supporting metrics:

- weekly active users
- completed orders
- order conversion rate
- repeat order rate
- 7/30-day retention
- average order value
- average preparation time
- pickup wait time
- cancellation rate
- refund rate
- rewards redemption
- gifting rate
- group-order rate
- vendor acceptance rate
- vendor preparation SLA
- payment failure rate
- payment reconciliation mismatch rate

Do not optimize GMV alone.

---

# 6. PRODUCT PRINCIPLES

## P1 — Pickup first

The first-class experience is order-ahead + pickup.

## P2 — Social should improve utility

Social features must create real value, not become noise.

## P3 — Rewards should drive repeat behavior

Rewards should reinforce:

- second order
- weekly frequency
- off-peak ordering
- referrals
- group orders
- gifting

## P4 — Transparent pricing

Show:

```text
Food subtotal
+
tax
+
platform fee (if any)
-
discount
-
reward
=
final amount
```

Never surprise the user at payment.

## P5 — Payment state is authoritative

Never infer payment success from UI state.

## P6 — Fulfilment state is separate from payment state

A payment can be captured while pickup has not happened.

## P7 — Every important financial/fulfilment mutation must be auditable.

## P8 — No feature is production-ready merely because its API works.

A feature is production-ready only when:

```text
UX
+
API
+
DB
+
security
+
error handling
+
observability
+
governance
+
evidence
```

are all addressed.

---

# 7. CORE CONSUMER INFORMATION ARCHITECTURE

Recommended mobile-first navigation:

```text
Home
Explore
Orders
Rewards
Profile
```

Optional social surface:

```text
Home
Explore
Social
Orders
Rewards
Profile
```

Do not overload the first release with a TikTok-style feed.

---

# 8. CONSUMER EXPERIENCE

## 8.1 Onboarding

Required:

- phone/email authentication
- OTP
- name
- profile photo optional
- campus selection
- favorite food categories optional
- dietary preferences optional
- notification permission
- location permission optional

Campus selection should support:

- search
- nearby campus
- invite/deep link
- organization code

---

# 9. HOME SCREEN

Home should answer immediately:

> "What can I order right now?"

Recommended sections:

1. Campus selector
2. Search
3. Quick reorder
4. Open now
5. Pickup in 10–20 min
6. Popular near you
7. Deals
8. Rewards progress
9. Friends ordering nearby
10. Gift a friend
11. Group order
12. Recently ordered

Do not make the user scroll through decorative content before food.

---

# 10. RESTAURANT DISCOVERY

Restaurant card:

- logo/photo
- restaurant name
- cuisine
- distance
- open/closed
- estimated preparation time
- pickup estimate
- rating
- offer
- reward multiplier
- popular item

Filters:

- open now
- pickup time
- price
- cuisine
- vegetarian
- vegan
- halal
- offers
- campus
- rating

---

# 11. RESTAURANT PAGE

Sections:

```text
Restaurant header
↓
Pickup estimate
↓
Deals
↓
Categories
↓
Menu
↓
Popular items
↓
Reviews
```

Menu item:

- image
- name
- description
- price
- customization
- dietary tags
- availability
- reward points

---

# 12. CART

Cart must show:

- items
- quantity
- modifiers
- subtotal
- taxes
- fees
- discount
- rewards applied
- final total
- pickup location
- pickup estimate
- restaurant preparation time

Actions:

- increase/decrease quantity
- remove item
- edit customization
- apply coupon
- apply rewards
- choose pickup time where supported

---

# 13. CHECKOUT

Checkout flow:

```text
Cart
 ↓
Pickup
 ↓
Payment
 ↓
Review
 ↓
Confirm
 ↓
Order Created
```

Payment methods should be extensible.

Initial:

- Razorpay
- UPI
- card
- supported wallet methods

Never store raw card credentials.

---

# 14. ORDER LIFECYCLE

Canonical conceptual states:

```text
CREATED
→ PAYMENT_PENDING
→ PAYMENT_AUTHORIZED
→ PAYMENT_CAPTURED
→ ACCEPTED
→ PREPARING
→ READY_FOR_PICKUP
→ PICKED_UP
```

Alternative terminal states:

```text
CANCELLED
REFUNDED
FAILED
EXPIRED
```

Payment and fulfilment MUST remain separate state machines.

---

# 15. ORDER TRACKING

Order screen should show:

```text
Order #SNZ-12345

✓ Order placed
✓ Payment confirmed
✓ Restaurant accepted
✓ Preparing
● Ready for pickup
○ Picked up
```

Show:

- estimated ready time
- live status
- restaurant contact
- pickup instructions
- pickup QR
- order details
- receipt

---

# 16. PICKUP QR

The pickup QR is a core product feature.

Flow:

```text
Order READY
     ↓
Generate pickup credential
     ↓
User reaches restaurant
     ↓
Vendor scans/verifies
     ↓
QR + OTP/cross-credential checks
     ↓
Attribution recorded
     ↓
Fulfilment → PICKED_UP
```

Governance requirements:

- credential must be scoped to order
- expired credential rejected
- wrong-order credential rejected
- duplicate pickup must be idempotent
- unauthorized pickup rejected
- pickup attribution must be auditable
- pickup must not be inferred merely from payment

Existing P0-07 / I-13 governance remains authoritative.

---

# 17. REWARDS ENGINE

Rewards should be configurable.

Initial model:

```text
₹X / $X spent → points
```

Bonus rules:

- first order
- second order
- streak
- referral
- off-peak order
- group order
- gifting
- campus events

Reward redemption:

- percentage discount
- fixed discount
- free item
- vendor-specific reward

Fraud controls:

- one reward per eligible event
- idempotent reward issuance
- no duplicate reward on retry
- ledger-based balance
- immutable reward transaction history

---

# 18. SOCIAL GRAPH

Minimum social model:

- follow/friend
- privacy settings
- friend list
- friend activity

Do NOT expose sensitive order details.

Example activity:

> "Alex ordered from Campus Cafe"

Optional:

> "Alex got a Chicken Wrap"

Never expose payment amount unless explicitly shared.

---

# 19. FOOD GIFTING

Gift flow:

```text
Select food
 ↓
Select friend
 ↓
Optional note
 ↓
Pay
 ↓
Friend notification
 ↓
Friend redeems
```

Gift states:

```text
CREATED
PAID
AVAILABLE
REDEEMED
EXPIRED
CANCELLED
REFUNDED
```

Fraud controls:

- recipient binding
- expiry
- redemption audit
- no double redemption
- payment/refund separation

---

# 20. GROUP ORDERING

Initial implementation should avoid unnecessary complexity.

Recommended model:

```text
Host creates group order
        ↓
Share link/code
        ↓
Friends join
        ↓
Each person selects items
        ↓
Host confirms
        ↓
Single merchant order
        ↓
Payment model
```

Support either:

### Model A
Host pays entire order.

### Model B
Split payment.

Implement Model A first unless business requirements demand split payments.

---

# 21. MEAL PLAN / ALLOWANCE

Future but architecturally reserve for:

- parent → student allowance
- daily limit
- weekly limit
- monthly limit
- merchant restrictions
- category restrictions
- campus restrictions
- expiry
- reporting

Do not implement complex wallet custody prematurely.

Treat allowance as an authorization/budget layer over payments where possible.

---

# 22. VENDOR APPLICATION

Vendor home:

```text
Today's orders
Revenue
Orders waiting
Average prep time
Low-stock alerts
```

Order queue:

```text
NEW
ACCEPTED
PREPARING
READY
PICKED_UP
CANCELLED
```

Actions:

- accept
- reject
- set prep time
- mark preparing
- mark ready
- verify pickup
- issue operational note

---

# 23. VENDOR MENU MANAGEMENT

Vendor can:

- create category
- create item
- edit price
- upload image
- configure modifiers
- mark unavailable
- schedule availability
- create deal
- configure reward multiplier

Menu changes must be versionable/auditable.

---

# 24. ADMIN APPLICATION

Admin modules:

```text
Overview
Users
Vendors
Orders
Payments
Refunds
Rewards
Fraud/Risk
Audit
Feature Flags
Support
Infrastructure
```

Emergency controls:

- disable new orders
- disable payments
- disable vendor
- disable gifting
- disable rewards
- disable group orders
- disable social
- disable invariant checker
- emergency read-only mode

All emergency controls require audit logging.

---

# 25. SUPPORT SYSTEM

Customer support should expose:

```text
Order
Payment
Fulfilment
Refund
Vendor
User
Evidence
Audit trail
```

Support staff must NOT directly mutate financial records without controlled workflows.

---

# 26. DATABASE DOMAIN MODEL

Core entities:

```text
User
Campus
Vendor
VendorLocation
MenuCategory
MenuItem
MenuModifier
Order
OrderItem
Payment
Refund
PickupCredential
PickupAttribution
RewardAccount
RewardLedgerEntry
Coupon
Gift
GroupOrder
GroupOrderMember
Notification
AuditLog
FeatureFlag
SupportTicket
```

Future:

```text
MealPlan
Allowance
Referral
SocialConnection
SocialActivity
VendorStaff
Inventory
POSIntegration
```

---

# 27. PAYMENT ARCHITECTURE

Payment must be modeled as a state machine.

Do not do:

```text
create order
→ call gateway
→ assume success
```

Instead:

```text
Create order
→ generate internal idempotency key
→ create payment intent/order
→ gateway interaction
→ verify callback/webhook
→ persist authoritative payment state
→ fulfilment proceeds according to policy
```

All external gateway calls must have explicit retry/idempotency strategy.

Existing Gateway E1-E9 governance remains mandatory.

---

# 28. GOVERNANCE ARCHITECTURE

Governance is not a final phase.

It runs continuously.

## Governance layers

### G1 — Authentication
- Supabase Auth
- OTP/email
- session validation

### G2 — Authorization
RBAC:

```text
CUSTOMER
VENDOR_OWNER
VENDOR_STAFF
SUPPORT
ADMIN
```

### G3 — Data integrity
- DB constraints
- transactions
- optimistic locking
- unique constraints

### G4 — Financial integrity
- idempotency
- payment state machine
- refund state machine
- reconciliation

### G5 — Fulfilment integrity
- payment ≠ pickup
- pickup attribution
- credential validation

### G6 — Auditability
- AuditLog
- immutable evidence
- actor
- timestamp
- before/after state
- request correlation ID

### G7 — Operational safety
- feature flags
- kill switches
- rollback
- DR

---

# 29. EXISTING GOVERNANCE BASELINE

The following existing state is considered part of the project baseline:

```text
P0-01   CLOSED
P0-02   CLOSED
P0-04   CLOSED
P0-06   CLOSED
P0-07   CLOSED
I-13    ENFORCED
HB-15   CLOSED

Firebase       ELIMINATED
Supabase       SOLE AUTH PLATFORM

Gateway E1-E8  PASS
Gateway E9     UNVERIFIED until concrete gateway evidence exists

M9/M10         PROHIBITED
realPayments   OFF
invariantChecker OFF
```

Do not weaken or remove these controls merely to make UI development easier.

---

# 30. PRODUCT DEVELOPMENT GOVERNANCE GATE

Every major feature must have a Feature Evidence Gate.

Template:

```text
FEATURE:
OWNER:
VERSION:

A. UX
[ ] User journey implemented
[ ] Loading state
[ ] Empty state
[ ] Error state
[ ] Success state
[ ] Mobile responsive

B. API
[ ] Authentication
[ ] Authorization
[ ] Validation
[ ] Idempotency where required
[ ] Error contract

C. DATABASE
[ ] Schema
[ ] Constraints
[ ] Indexes
[ ] Migration
[ ] Audit requirements

D. SECURITY
[ ] RBAC
[ ] Input validation
[ ] Sensitive data handling
[ ] Abuse/fraud controls

E. OBSERVABILITY
[ ] Logs
[ ] Metrics
[ ] Correlation IDs
[ ] Failure visibility

F. TESTING
[ ] Unit
[ ] Integration
[ ] E2E
[ ] Regression

G. EVIDENCE
[ ] Positive path
[ ] Negative path
[ ] Retry path
[ ] Unauthorized path
[ ] Persistence verification

H. PRODUCTION
[ ] Feature flag
[ ] Rollback
[ ] Kill switch if needed
[ ] Runbook
```

A feature is not "DONE" until its required sections are complete.

---

# 31. IMPLEMENTATION STRATEGY

Do NOT attempt to implement all features simultaneously.

Use vertical slices.

Each slice must travel:

```text
Idea
→ UX
→ DB
→ API
→ UI
→ Governance
→ E2E
→ Evidence
→ Release candidate
```

---

# 32. PHASE 0 — BASELINE & PRODUCT RESET

Objective:

Stop infrastructure-only development from consuming the project.

Tasks:

1. Lock current governance baseline.
2. Preserve P0-01/P0-02/P0-04/P0-06/P0-07.
3. Preserve I-13.
4. Preserve payment/idempotency safeguards.
5. Inventory existing UI.
6. Create product backlog.
7. Define design system.
8. Establish feature-gate template.

Acceptance:

```text
Governance preserved
+
Product backlog approved
+
No production activation
```

---

# 33. PHASE 1 — DESIGN SYSTEM

Build:

- typography
- colors
- spacing
- buttons
- cards
- inputs
- chips
- tabs
- bottom navigation
- restaurant cards
- menu cards
- order timeline
- reward components
- modal/sheet
- toast
- skeleton
- empty states

Primary visual direction:

Modern campus food app.

Avoid copying Snackpass.

---

# 34. PHASE 2 — CONSUMER MVP

Implement in this order:

### 2.1 Auth
### 2.2 Campus selection
### 2.3 Home
### 2.4 Restaurant discovery
### 2.5 Restaurant detail
### 2.6 Menu
### 2.7 Cart
### 2.8 Checkout
### 2.9 Order creation
### 2.10 Order tracking
### 2.11 Pickup QR
### 2.12 Order history
### 2.13 Reorder

This becomes the first complete vertical slice.

---

# 35. PHASE 3 — VENDOR MVP

Implement:

1. Vendor auth
2. Order queue
3. Accept/reject
4. Preparation status
5. Ready status
6. Pickup verification
7. Menu management
8. Basic analytics

The consumer and vendor flows must be tested together.

---

# 36. PHASE 4 — PAYMENTS

Implement:

- Razorpay test mode
- payment initiation
- payment verification
- webhook handling
- idempotency
- failure handling
- refund
- reconciliation

Acceptance:

```text
one successful payment
one failed payment
one retry
duplicate request
webhook retry
refund
```

Gateway E9 must be proven with concrete evidence.

---

# 37. PHASE 5 — REWARDS

Implement:

- points ledger
- earn rules
- balance
- redemption
- reward history
- expiry
- fraud prevention

Every reward mutation must be idempotent.

---

# 38. PHASE 6 — SOCIAL + GIFTING

Implement:

1. Friend discovery
2. Follow/friend
3. Activity feed
4. Food gifting
5. Gift redemption
6. Privacy controls

Keep feed lightweight.

---

# 39. PHASE 7 — GROUP ORDERING

Implement:

- create group order
- invite
- join
- individual cart
- host confirmation
- payment
- preparation
- pickup

Run concurrency tests.

---

# 40. PHASE 8 — CAMPUS ECONOMY

Implement:

- campus offers
- student verification
- meal credits
- allowances
- sponsored credits
- campus promotions

This should be configurable per campus.

---

# 41. PHASE 9 — ADVANCED VENDOR

Add:

- analytics
- inventory
- scheduled menu
- promotions
- staff accounts
- POS integration
- multi-location

Only after MVP economics are proven.

---

# 42. PHASE 10 — PLATFORM HARDENING

Complete:

- DR
- rollback
- observability
- security review
- performance testing
- rate limiting
- abuse prevention
- financial reconciliation
- production evidence gate

---

# 43. END-TO-END GOLDEN JOURNEY

The IDE must eventually prove this complete journey:

```text
Student signs up
 ↓
Selects campus
 ↓
Finds restaurant
 ↓
Selects menu item
 ↓
Customizes
 ↓
Adds to cart
 ↓
Checks transparent total
 ↓
Pays using TEST gateway
 ↓
Order created
 ↓
Vendor receives order
 ↓
Vendor accepts
 ↓
Vendor prepares
 ↓
Vendor marks READY
 ↓
Student receives notification
 ↓
Student arrives
 ↓
Student presents pickup QR
 ↓
Vendor verifies
 ↓
Pickup attribution recorded
 ↓
Order becomes PICKED_UP
 ↓
Reward points issued exactly once
 ↓
Receipt appears
 ↓
Order appears in history
 ↓
Student can reorder
```

This is the primary product acceptance test.

---

# 44. NEGATIVE GOLDEN JOURNEYS

Must also prove:

### N1 Wrong QR
Rejected.

### N2 Wrong OTP
Rejected.

### N3 Wrong order credential
Rejected.

### N4 Duplicate pickup
Idempotent.

### N5 Duplicate payment request
Exactly one financial effect.

### N6 Webhook replay
No duplicate payment mutation.

### N7 Unauthorized vendor
Rejected.

### N8 Customer attempts vendor mutation
Rejected.

### N9 Cancelled order pickup
Rejected.

### N10 Payment captured but pickup absent
Order remains not picked up.

---

# 45. UX QUALITY GATE

Before declaring a consumer feature complete, verify:

- no placeholder UI
- no demo credentials displayed in production UI
- no fake success states
- no hardcoded order data
- no fake payment success
- no broken loading states
- no empty screen without explanation
- no dead buttons
- no unhandled API errors
- no horizontal overflow
- mobile-first behavior
- accessibility basics
- clear confirmation after mutation

---

# 46. TECHNICAL IMPLEMENTATION RULES

## Frontend

Prefer existing project stack unless there is a strong reason to change it.

Use:

- Next.js / React
- TypeScript
- Tailwind or existing styling system
- reusable components
- typed API client
- server/client boundaries intentionally

Do not rewrite the stack simply for aesthetics.

## Backend

Existing backend architecture should be extended, not duplicated.

Avoid creating a second parallel order/payment system.

## Database

Use PostgreSQL/Supabase as authoritative application database.

## Auth

Supabase is the sole authentication platform.

## Payments

Razorpay abstraction must remain replaceable.

---

# 47. API DESIGN PRINCIPLES

Every mutation endpoint must define:

```text
authentication
authorization
input schema
idempotency
transaction boundary
side effects
audit event
error codes
HTTP status
```

Example:

```text
POST /api/orders
POST /api/orders/:id/payment
POST /api/orders/:id/cancel
POST /api/orders/:id/pickup/verify
POST /api/vendor/orders/:id/accept
POST /api/vendor/orders/:id/ready
POST /api/rewards/redeem
POST /api/gifts
POST /api/group-orders
```

Exact route names should follow existing codebase conventions when already present.

---

# 48. EVENT ARCHITECTURE

Important events:

```text
ORDER_CREATED
PAYMENT_REQUESTED
PAYMENT_CAPTURED
PAYMENT_FAILED
ORDER_ACCEPTED
ORDER_PREPARING
ORDER_READY
PICKUP_VERIFIED
ORDER_PICKED_UP
ORDER_CANCELLED
REFUND_REQUESTED
REFUND_COMPLETED
REWARD_EARNED
REWARD_REDEEMED
GIFT_CREATED
GIFT_REDEEMED
GROUP_ORDER_CREATED
```

Events must not replace authoritative DB state.

---

# 49. IDE EXECUTION PROTOCOL

For every implementation directive:

## Step 1 — Read first

IDE must inspect:

- architecture docs
- existing feature implementation
- DB schema
- route inventory
- governance rules
- feature flags
- tests
- current git state

## Step 2 — Produce implementation plan

Before changing code, identify:

```text
Files to modify
Files to create
DB changes
API changes
UI changes
Tests
Governance impact
Rollback
Evidence
```

## Step 3 — Implement smallest vertical slice

Do not build a large disconnected UI mock.

## Step 4 — Run local validation

At minimum:

```text
lint
typecheck
build/compile
unit tests
integration tests where available
```

## Step 5 — Run feature evidence gate

Positive + negative + retry + authorization + persistence.

## Step 6 — Regression check

Verify:

```text
P0-06
P0-07
I-13
Gateway
M9/M10
Firebase=0
Supabase auth
production flags OFF
```

## Step 7 — Commit

Use descriptive commit message.

Never use opaque UUID-only commit messages.

## Step 8 — Report

Return:

```text
Directive
Scope
Files changed
Implementation
Tests
Evidence
Governance impact
Regression
Remaining blockers
Next directive
```

---

# 50. GOVERNANCE STOP CONDITIONS

The IDE must STOP and escalate if:

- payment state semantics change
- fulfilment state semantics change
- pickup attribution logic changes
- idempotency behavior changes
- retry behavior changes
- RBAC boundary changes
- audit/WORM semantics change
- production flag activation is requested
- database destructive migration is required
- external production credential is needed
- evidence contradicts implementation
- a test requires bypassing a safety control

Do not "fix" a governance failure by weakening the gate.

---

# 51. NO-GO CONDITIONS

Production remains NO-GO if any of the following is unresolved:

```text
P0 critical path failure
I-13 failure
Gateway E9 unverified
DR drill unverified
Rollback drill unverified
payment reconciliation unresolved
critical RBAC failure
critical audit failure
critical security finding
production environment not proven
```

Current known status from the latest evidence assessment:

```text
Production = NO-GO
```

Do not change this merely because the product UI is being built.

---

# 52. CURRENT OPERATOR / INFRASTRUCTURE STATE

From the latest evidence assessment:

```text
HB-7  Production Supabase     VERIFY
HB-8  Vercel                  SUBSTANTIALLY PASS
HB-9  Fly.io ×5               BLOCKED
HB-10 Razorpay                PROVISIONED / OFF
HB-11 Supabase Auth           SUBSTANTIALLY PASS
HB-12 DB roles/WORM           UNVERIFIED
HB-13 GitHub environment      SUBSTANTIALLY PASS
HB-14 outbox publisher        BLOCKED
E9    Gateway                 UNVERIFIED
HB-5  DR                      NOT VERIFIED
HB-6  Rollback                NOT VERIFIED

realPayments                  OFF
invariantChecker              OFF
M9/M10                        PROHIBITED
Production                    NO-GO
```

This infrastructure status is a governance state, not a reason to stop product development.

---

# 53. BACKLOG PRIORITY

## P0 — Product critical

1. Consumer auth
2. Restaurant discovery
3. Menu
4. Cart
5. Checkout
6. Order
7. Vendor order queue
8. Preparation
9. Ready
10. Pickup QR
11. Pickup verification
12. Order history

## P1

13. Rewards
14. Reorder
15. Notifications
16. Gifting
17. Vendor menu management
18. Admin operations

## P2

19. Group ordering
20. Social feed
21. Referrals
22. Campus promotions
23. Meal plans

## P3

24. POS
25. Inventory
26. Multi-location
27. advanced analytics
28. advanced social

---

# 54. BRAINSTORMING BACKLOG

Potential differentiators:

### Campus Pass
One campus identity and wallet/benefit layer.

### Smart Pickup
Dynamic pickup windows based on vendor queue.

### Queue Prediction
Predict readiness using historical preparation time.

### Friend Radar
Show friends who are currently ordering, with privacy controls.

### Split Group Cart
Each friend owns their item selection.

### Gift Drops
Send a food gift that becomes redeemable for a limited time.

### Campus Challenges
Weekly food/reward challenges.

### Streaks
Reward repeat pickup behavior.

### Smart Reorder
Predict what the student is likely to order.

### Group Deals
Discount triggered by number of participants.

### Off-Peak Rewards
Encourage restaurants to move demand.

### Vendor Boost
Vendor can create time-limited campaigns.

### Campus Food Map
Map-based discovery.

### Event Ordering
Pre-order for college events.

### Club / Society Ordering
Group orders for student organizations.

### Sponsor Credits
Brands/campuses fund food credits.

These remain ideas until promoted into the roadmap.

---

# 55. ANTI-FEATURES

Do NOT build prematurely:

- full delivery fleet
- complicated wallet custody
- crypto/token economy
- unlimited social feed
- complex AI recommendation platform
- full POS replacement
- nationwide marketplace
- dozens of payment providers
- excessive microservices

The product must first prove:

```text
Order
→ Pay
→ Prepare
→ Pickup
→ Reward
→ Reorder
```

---

# 56. DEFINITION OF DONE

A feature is DONE only when:

```text
[ ] User story works
[ ] UI complete
[ ] API complete
[ ] DB complete
[ ] Error states complete
[ ] Auth complete
[ ] RBAC complete
[ ] Idempotency considered
[ ] Audit considered
[ ] Tests pass
[ ] E2E path works
[ ] Regression passes
[ ] Evidence recorded
[ ] Rollback understood
[ ] Feature flag defined where appropriate
```

---

# 57. FIRST IMPLEMENTATION DIRECTIVE

The next IDE implementation should NOT be infrastructure provisioning.

It should be:

## `SNAKZAP-PRODUCT-FOUNDATION-IMPLEMENT-01`

Objective:

Build the first real consumer vertical slice.

Scope:

```text
Auth
→ Campus selection
→ Home
→ Restaurant discovery
→ Restaurant detail
→ Menu
→ Cart
```

Do NOT yet activate production payments.

Use test/mock payment boundaries only where needed.

At the same time:

- preserve existing governance
- do not change P0-06/P0-07
- do not change I-13
- do not enable realPayments
- do not enable invariantChecker
- keep M9/M10 prohibited
- do not claim production readiness

Acceptance:

A test user can navigate from login to a real restaurant menu and build a real cart using database-backed data.

---

# 58. SECOND IMPLEMENTATION DIRECTIVE

After Product Foundation:

## `SNAKZAP-ORDER-PAYMENT-VERTICAL-SLICE-IMPLEMENT-01`

Scope:

```text
Cart
→ Checkout
→ Test payment
→ Order creation
→ Vendor queue
→ Accept
→ Preparing
→ Ready
→ Pickup QR
→ Pickup verification
→ Picked Up
→ Reward
→ History
```

This is the first true end-to-end product milestone.

---

# 59. THIRD IMPLEMENTATION DIRECTIVE

## `SNAKZAP-REWARDS-GIFTING-IMPLEMENT-01`

Scope:

- rewards ledger
- earn
- redeem
- gifting
- gift redemption
- notifications
- audit
- fraud controls

---

# 60. FOURTH IMPLEMENTATION DIRECTIVE

## `SNAKZAP-SOCIAL-GROUP-IMPLEMENT-01`

Scope:

- friends
- social activity
- privacy
- group order
- invite
- host flow
- group preparation
- pickup

---

# 61. FINAL ORCHESTRATOR RULE

The Orchestrator should maintain two simultaneous dashboards.

## PRODUCT READINESS

```text
Consumer UX       %
Vendor UX         %
Admin UX          %
Order flow        %
Payment UX        %
Rewards           %
Social            %
Gifting           %
Group ordering    %
```

## GOVERNANCE READINESS

```text
P0 status
Invariant status
Payment integrity
RBAC
Audit
Idempotency
DR
Rollback
Infrastructure
Security
Evidence
```

A green governance dashboard does not imply a green product dashboard.

A green product dashboard does not imply production authorization.

Production requires BOTH.

---

# 62. FINAL PRINCIPLE

The project should now move from:

```text
"Can the backend prove that the system is safe?"
```

to:

```text
"Can a real student successfully use the product end-to-end,
while the system proves that every important action is safe?"
```

That is the new Snakzap development standard.

---

# END OF MASTER BLUEPRINT
