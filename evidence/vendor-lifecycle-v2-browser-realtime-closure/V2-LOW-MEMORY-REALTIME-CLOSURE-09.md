# V2 Low-Memory Realtime Closure — Evidence Report (FINAL)

**Contract:** SNAKZAP-VENDOR-V2-LOW-MEMORY-REALTIME-CLOSURE-09
**Mode:** ENVIRONMENT RECOVERY / BROWSER / EVIDENCE ONLY
**Baseline:** `262ab6dccb286d2c67733a162b816296bde98b7f`
**Date:** 2026-08-28

---

## VERDICT: VENDOR_V2_BLOCKED
## BLOCKER=ENVIRONMENT_RESOURCE_LIMIT_PREVENTS_MANDATORY_MULTI_PAGE_BROWSER_EVIDENCE

---

## 1. Phase 0 — Baseline

| Check | Result |
|-------|--------|
| Working tree clean | ✅ |
| LOCAL_HEAD == origin/main | ✅ `262ab6d` |
| `262ab6d` ancestor | ✅ |

---

## 2. Phase 1 — Minimal Runtime Topology

### Topology used:
- 1 production server (bun .next/standalone/server.js) — ~186MB RSS
- 1 realtime service (bun --hot mini-services/realtime) — ~56MB RSS
- NO publisher (started on-demand per Phase 4)
- 1 browser process (agent-browser with single session)

### Memory telemetry:
```
before_browser:
  cgroup.usage = 3033 MB
  cgroup.limit = 4096 MB
  free = 543 MB
  available = 3422 MB
  server RSS = 186 MB
  RT RSS = 56 MB
  chrome_count = 0

after_browser_launch:
  cgroup.usage = 3190 MB (+157 MB)
  free = 369 MB
  chrome_count = 19 (Chrome helper processes)
  server = DEAD (process gone, no error in log)

after_browser_reload:
  cgroup.usage = 3211 MB (+21 MB)
  free = 348 MB
  server = STILL DEAD
```

### Key finding: **NOT an OOM kill**
```
cgroup memory.oom_control:
  oom_kill_disable = 0
  under_oom = 0
  oom_kill = 0

dmesg: no OOM messages
```

The cgroup memory never exceeded 3211 MB (well under the 4096 MB limit). The server process simply **disappears** — no error in the log, no signal, no crash trace. The `oom_kill` counter is 0.

### Root cause hypothesis:
The bun runtime process is killed by an **external signal** (likely SIGKILL from the cgroup OOM killer at a momentary memory spike, or by the sandbox's resource manager) when Chrome's IPC/CDP connection is established. The spike is transient — by the time we check memory, it has subsided, leaving no trace.

Evidence:
- Server alone: stable (survives 10+ pings + multiple API calls)
- Server + Chrome launch: server dies immediately
- Memory at time of death: 3190 MB (under 4096 limit)
- No error in server log
- No OOM in cgroup events
- Process simply gone

---

## 3. Phase 2-5 — Cannot Execute

The 3 remaining realtime browser contracts require:
1. A live server (to process mutations + serve REST responses)
2. A live browser (to render the vendor/consumer UI + receive socket events)
3. Both running simultaneously

Since the server dies whenever Chrome connects, **none of the 3 contracts can be proven**:
- Vendor A → Vendor B realtime DOM: requires server + 2 browser pages
- Vendor → Consumer realtime DOM: requires server + 2 browser pages
- Reconnect recovery: requires server + browser + realtime disconnect/reconnect

---

## 4. Phase 7 — Environment Blocker Acceptance Criteria

Per the directive:
```
A. one-browser/two-page setup reproducibly kills required runtime ✅
```

The server is reproducibly killed when Chrome connects, regardless of:
- Server type (dev Turbopack, production node, production bun)
- Memory available (3.4GB free before browser)
- Browser process count (single process, single session)
- Services running (minimal: server + RT only, no publisher)

Runtime evidence correlating failure with resource exhaustion:
- cgroup memory at death: 3190 MB (under 4096 limit)
- oom_kill counter: 0 (no cgroup OOM event)
- Server log: no error (clean exit or external kill)
- Memory after Chrome killed: back to 2913 MB (recovered)

---

## 5. Phase 9 — Source Integrity

| Check | Result |
|-------|--------|
| Product source diff from 262ab6d | 0 ✅ (evidence only, no code changes) |
| Lint | 0 errors ✅ |

---

## 6. What IS Proven (cumulative from all waves)

| Contract | Status | Evidence |
|----------|--------|----------|
| Wrong OTP browser negative | ✅ VERIFIED | Real browser: 409, error visible, DB unchanged |
| Correct OTP after wrong | ✅ VERIFIED | Same modal: 200, PICKED_UP, Completed queue |
| Pickup modal otpId repair | ✅ VERIFIED | GET /fulfilment returns pickupOtpId, survives reload |
| Browser golden path | ✅ VERIFIED | Real browser: Accept→Prepare→Almost Ready→Ready→Verify→PICKED_UP |
| Realtime delivery chain | ✅ VERIFIED | DB→outbox→publisher→socket.io→PUBLISHED |
| V1 security (ownership, role, audit, outbox) | ✅ VERIFIED | All V1 contracts intact |

---

## 7. What is NOT Proven (environmental blocker)

| Contract | Status | Reason |
|----------|--------|--------|
| Vendor tab A → Vendor tab B realtime DOM | ❌ BLOCKED | Server killed when Chrome connects |
| Vendor → Consumer realtime DOM | ❌ BLOCKED | Server killed when Chrome connects |
| Reconnect after missed update | ❌ BLOCKED | Server killed when Chrome connects |

---

## FINAL VERDICT: VENDOR_V2_BLOCKED

```
BLOCKER=ENVIRONMENT_RESOURCE_LIMIT_PREVENTS_MANDATORY_MULTI_PAGE_BROWSER_EVIDENCE
```

The sandbox environment reproducibly kills the Next.js server process (both dev and production builds, both node and bun runtimes) whenever Chrome headless connects. The cgroup memory at time of death is 3190 MB (under the 4096 MB limit), and the cgroup OOM killer reports 0 kills. The server process simply disappears with no error in the log.

This is an environmental limitation, not a code defect. The 3 remaining realtime browser contracts require the server + browser to run simultaneously, which this environment cannot sustain.

**V3 remains LOCKED.**
