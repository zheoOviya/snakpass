# Task 6B — Social Screen + Friends Screen + 6th Bottom-Nav Tab

**Wave:** 6 (Social + Gifting)
**Task ID:** 6B
**Agent:** full-stack-developer
**Date:** (current session)

## Summary

Implemented the consumer Social tab UI as the Wave 6 expansion of the SnakZap
mobile bottom-nav. Adds two new screens (`SocialScreen` + `FriendsScreen`),
splits the existing Social tab placeholder into a real social feed + a separate
6th Profile tab, and wires the violet activity dot on the Social tab to the
social-store's pending incoming friend requests.

## Files

### Created

- `src/components/snak/screens/social-screen.tsx`
  - `SocialScreen` host with internal Feed/Friends sub-tab bar (violet underline accent, framer-motion `layoutId` for sliding indicator).
  - Feed pane: SocialFeedCard list, refresh button, "Load more" pagination (client-side slice of store's 30-item window), empty state CTA that jumps to Friends pane.
  - Friends pane: renders FriendsScreen.
  - Partial-failure amber banner surfaces social-store.error.

- `src/components/snak/screens/friends-screen.tsx`
  - Search bar (debounced 250ms, min 2 chars).
  - Pending incoming requests (Accept/Reject buttons with per-row busy state).
  - Pending outgoing requests (Pending label).
  - Current friends list (avatar + name + campus + Message + Unfriend with confirm dialog).
  - Search results with "Add friend" button — excludes already-connected + pending-sent users.

### Modified (additive only)

- `src/components/snak/bottom-nav.tsx`
  - `BottomNavTab` now includes `'profile'`.
  - TABS array grows from 5 to 6 (Home/Explore/Social/Orders/Rewards/Profile).
  - Profile icon: `User` from lucide-react.
  - Labels collapse to icon-only on very narrow viewports (`max-[359px]:hidden`).
  - Active pill shrinks slightly on narrow screens (`w-12` → `max-[359px]:w-10`) so it fits cleanly within the 6-tab layout.

- `src/lib/ui-store.ts`
  - Comment block updated to reflect Wave 6 split (Social = real feed; Profile = own tab).
  - No code change needed — `BottomNavTab` is imported from `bottom-nav.tsx` so adding `'profile'` to the type flows through automatically.

- `src/components/snak/app-shell.tsx`
  - Imports `useSocial`.
  - Adds `hasPendingSocial` selector (true when connections has any `PENDING_IN` entry).
  - Passes `socialActivity={hasPendingSocial}` to BottomNav — violet dot on Social tab lights up when user has pending friend requests.

## Governance boundaries respected

- ❌ Did NOT touch any API route (`src/app/api/**`) — Task 6A owns `/api/social/**`.
- ❌ Did NOT touch `src/components/snak/consumer-view.tsx` — Task 3A owns; will swap the `activeTab === 'social'` branch from `<ProfileScreen />` to `<SocialScreen />` and add a `activeTab === 'profile'` branch.
- ❌ Did NOT touch `src/components/snak/screens/home-screen.tsx` — Task 6D may add Gift CTA.
- ❌ Did NOT touch payment/fulfilment/pickup governance files.
- ❌ Did NOT touch `prisma/schema.prisma`.
- ❌ Did NOT touch `src/lib/social-store.ts` — Task 1C owns; READ only, called its methods.

## API contracts my UI expects (for Task 6A to land)

- `GET /api/social/connections` → `{ connections: SocialConnection[] }` (status: PENDING_IN | PENDING_OUT | ACCEPTED | BLOCKED).
- `GET /api/social/feed?limit=30` → `{ feed: SocialActivity[] }`.
- `GET /api/social/search?q=...` → `{ users: Array<{ id, name, phone?, avatarUrl?, campusName? }> }`.
- `POST /api/social/connections` body `{ targetUserId, message? }` → `{ connection: SocialConnection }`.
- `PATCH /api/social/connections/[id]` body `{ action: 'ACCEPT' | 'REJECT' }`.
- `DELETE /api/social/connections/[id]`.

The UI handles missing/unresponsive endpoints gracefully — social-store surfaces a soft "Partial failure" error string that the SocialScreen displays as a non-blocking amber banner; the FriendsScreen surfaces search errors as a Card row.

## Verification

- `bun run lint` exits 0 (only pre-existing module-type warning unrelated to my files).
- `bunx tsc --noEmit --skipLibCheck` — zero new errors in my files. Pre-existing errors in `src/lib/razorpay.ts`, `src/lib/webhook-processor.ts`, `src/app/api/webhooks/**`, etc. are untouched.
- Dev server (port 3000): HTTP 200 on `/` and `/consumer`. Turbopack compiled both routes successfully with the new SocialScreen + FriendsScreen bundled into the consumer chunk.

## Coordination notes for downstream tasks

- **Task 3A** — to activate the SocialScreen UI, swap consumer-view.tsx's `{activeTab === 'social' && <ProfileScreen />}` to `{activeTab === 'social' && <SocialScreen />}` and add `{activeTab === 'profile' && <ProfileScreen />}`. Also widen `ConsumerViewProps.initialTab` union to include `'profile'`.
- **Task 6A** — the API contracts above are what the UI calls. The store wraps them; screens call the store. No screen touches `/api/social/*` directly except `FriendsScreen` for `/api/social/search` (transient, non-cached query — by design, not in the store).
- **Task 6D** — Gift CTA on home-screen.tsx is preserved (currently shows a "Gifting coming in Wave 6" toast). Gift inbox UI lives elsewhere (not in SocialScreen).
