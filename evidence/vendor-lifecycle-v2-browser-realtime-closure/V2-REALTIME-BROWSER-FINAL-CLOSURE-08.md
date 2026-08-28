# V2 Realtime Browser Final Closure — Evidence Report

**Contract:** SNAKZAP-VENDOR-V2-REALTIME-BROWSER-FINAL-CLOSURE-08
**Mode:** EVIDENCE ONLY
**Baseline:** `05690215ef74a431e3f609fba35045144098caae`
**Date:** 2026-08-28

---

## VERDICT: VENDOR_V2_BLOCKED
## BLOCKER=VENDOR_BROWSER_REALTIME_FLOW_ENVIRONMENT_UNSTABLE

---

## 1. Phase 0 — Baseline Freeze

| Check | Result |
|-------|--------|
| Working tree clean | ✅ |
| LOCAL_HEAD == origin/main | ✅ `0569021` |
| `0569021` ancestor | ✅ |

---

## 2. What Was Attempted

### Strategy 1: Dev server (Turbopack)
- Server crashes during browser navigation (OOM: 4GB cgroup limit)
- Multiple attempts across 7+ waves — server always dies when Chrome connects

### Strategy 2: Production build (`next build` + `next start`)
- Built successfully after fixing supabase env vars
- Server alone: **stable** (10/10 pings OK, 3.3GB free)
- Server + Chrome headless: **OOM killed** during navigation
- Watchdog restarts server, but Chrome's next request arrives before server is ready → `ERR_CONNECTION_REFUSED`

### Strategy 3: Watchdog + rapid restart
- Watchdog keeps restarting the server (1s interval)
- But Chrome needs multiple sequential requests (navigate → set cookies → navigate → API calls)
- Each request may arrive when server is briefly down → `ERR_CONNECTION_REFUSED`
- Cannot sustain the multi-step browser interaction needed for realtime proofs

---

## 3. Root Cause Analysis

**4GB cgroup memory limit** (`memory.limit_in_bytes = 4294967296`)

Memory breakdown when browser + server run together:
- Chrome headless: ~800MB-1.2GB (multiple processes)
- Next.js server: ~600MB-1GB (dev or production)
- Realtime + publisher services: ~200MB
- System + buff/cache: ~2GB
- **Total: exceeds 4GB → OOM killer kills the server** (highest memory consumer)

### Evidence:
- Server alone with 3.3GB free: stable (10/10 pings)
- Browser launches + navigates: server killed
- No error in server log — process simply disappears (OOM kill is silent from the process's perspective)
- `dmesg` shows no OOM messages (cgroup-level kill, not system-level)

---

## 4. What IS Proven (from previous waves)

| Contract | Status | Evidence |
|----------|--------|----------|
| Wrong OTP browser negative | ✅ VERIFIED | Real browser: 409, error visible, DB unchanged |
| Correct OTP after wrong | ✅ VERIFIED | Same modal: 200, PICKED_UP, Completed queue |
| Pickup modal otpId repair | ✅ VERIFIED | GET /fulfilment returns pickupOtpId, survives reload |
| Browser golden path | ✅ VERIFIED | Real browser: Accept→Prepare→Almost Ready→Ready→Verify Pickup→PICKED_UP |
| Realtime delivery chain | ✅ VERIFIED | DB → outbox → publisher → socket.io → PUBLISHED |

---

## 5. What IS NOT Proven (environmental blocker)

| Contract | Status | Reason |
|----------|--------|--------|
| Vendor tab A → Vendor tab B realtime DOM | ❌ BLOCKED | Cannot sustain 2 browser tabs + server |
| Vendor → Consumer realtime DOM | ❌ BLOCKED | Cannot sustain 2 browser tabs + server |
| Reconnect after missed update | ❌ BLOCKED | Cannot sustain browser + server + realtime disconnect/reconnect |

---

## 6. Source Freeze

| Check | Result |
|-------|--------|
| Product source diff from 0569021 | 0 ✅ (evidence only, no code changes) |
| Lint | 0 errors ✅ |

---

## FINAL VERDICT: VENDOR_V2_BLOCKED

```
BLOCKER=VENDOR_BROWSER_REALTIME_FLOW_ENVIRONMENT_UNSTABLE
```

The 3 remaining realtime browser contracts require sustained multi-tab browser sessions (2+ Chrome tabs + server + realtime + publisher). The sandbox's 4GB cgroup memory limit causes the Next.js server to be OOM-killed whenever Chrome headless runs alongside it. This is an environmental limitation, not a code defect.

The realtime delivery chain is proven at the infrastructure level (DB → outbox → publisher → socket.io → PUBLISHED), and the vendor-view's `order:updated` listener + `refreshOrders()` refetch mechanism is verified at the code level. But the mandatory DOM-level browser proof (2 tabs seeing each other's updates without reload) cannot be captured because the server cannot survive the sustained browser session.

**V3 remains LOCKED.**
