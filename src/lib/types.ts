// Shared frontend types for SnakZap.

export interface Restaurant {
  id: string
  name: string
  cuisine: string
  description: string
  image: string
  rating: number
  prepTimeMins: number
  priceForTwo: number
  address: string
  availableItems?: number
  gstNumber?: string
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  image: string
  spiceLevel: number
  isVeg: boolean
  isAvailable: boolean
  category: string
}

export interface OrderItem {
  id?: string
  name: string
  price: number
  quantity: number
  subtotal: number
  menuItemId?: string
}

export interface Order {
  id: string
  status: string
  totalAmount: number
  pickupOtp: string
  isCatering: boolean
  headcount: number | null
  itemsCount: number
  note: string | null
  createdAt: string
  updatedAt: string
  statusHistory: string
  restaurant: { id: string; name: string; cuisine?: string; address?: string; prepTimeMins?: number }
  items: OrderItem[]
}

export interface KillSwitch {
  id: string
  key: string
  label: string
  description: string
  enabled: boolean
  severity: string
  updatedAt: string
}

export interface AuditLog {
  id: string
  actorId: string | null
  actorName: string
  actorRole: string
  action: string
  metadata: string
  createdAt: string
}

export interface AdminMetrics {
  totalOrders: number
  activeOrders: number
  pickedUp: number
  cancelled: number
  revenue: number
  settled: number
  aov: number
  restaurants: number
  activeRestaurants: number
  menuItems: number
  consumers: number
  completionRate: number
  cancellationRate: number
}

// ════════════════════════════════════════════════════════════════════════════
//  PREMIUM UI TYPES — Wave 1B additions (additive — preserve existing above)
//  Reference: DESIGN_SYSTEM.md §5.2.4–5.2.7, blueprint §17–§22.
//  These interfaces are the UI contract; backend Wave 2+ tasks will wire them
//  to Prisma models via API route responses.
// ════════════════════════════════════════════════════════════════════════════

/** A campus / organisation a consumer can belong to (blueprint §4.3, §8.1). */
export interface Campus {
  id: string
  name: string
  /** Short display name for chips (e.g., "IIT Bombay"). */
  shortName?: string
  city: string
  state?: string
  /** Distance in km from the user's current location, if known. */
  distanceKm?: number
  /** Optional logo URL — falls back to a gradient avatar. */
  logoUrl?: string
  /** Optional org-code for private campuses (blueprint §5.3.2 "Have an org code?"). */
  orgCode?: string
  /** Whether this campus requires student-email verification to join. */
  requiresVerification?: boolean
}

/** A consumer's reward account (blueprint §17 Rewards Engine). */
export interface RewardAccount {
  id: string
  userId: string
  campusId?: string
  pointsBalance: number
  /** Total points ever earned (lifetime). Drives tier upgrades. */
  lifetimePoints: number
  tierName: string // 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond'
  /** ISO date string — when the account was created. */
  createdAt: string
  /** ISO date string — last time points were awarded or redeemed. */
  updatedAt: string
}

/** A single line in the rewards ledger (blueprint §17, G7 Auditability). */
export interface RewardLedgerEntry {
  id: string
  accountId: string
  /** 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST' */
  type: string
  /** Positive for EARN, negative for REDEEM/EXPIRE. */
  points: number
  /** Running balance AFTER this entry was applied. */
  balanceAfter: number
  /** Why — 'order:SNZ-12345', 'redemption:checkout', 'expiry:30d', 'admin:adjust'. */
  reason: string
  /** Optional order ID that triggered this entry. */
  orderId?: string
  /** ISO timestamp. */
  createdAt: string
}

/** A reward rule — server-side definition (blueprint §17). UI mirror only. */
export interface RewardRule {
  id: string
  /** 'earn_per_rupee' | 'earn_multiplier' | 'first_order_bonus' | 'tier_bonus'. */
  type: string
  /** Numeric parameter — rate, multiplier, bonus points. */
  value: number
  /** Optional restaurant scope (per-restaurant promo). */
  restaurantId?: string
  /** Optional campus scope. */
  campusId?: string
  /** ISO date — when this rule started. */
  startsAt?: string
  /** ISO date — when this rule stops. */
  endsAt?: string
  active: boolean
}

/** A food gift sent from one consumer to another (blueprint §19 Food Gifting). */
export interface Gift {
  id: string
  senderId: string
  recipientId: string
  senderName: string
  recipientName: string
  /** Optional sender avatar URL. */
  senderAvatarUrl?: string
  /** The menu item being gifted. */
  menuItemId: string
  itemName: string
  /** Restaurant the item is from. */
  restaurantId: string
  restaurantName: string
  /** Item image (or gradient placeholder key). */
  itemImageUrl?: string
  /** Gift value in paise (item price at time of gift). */
  valuePaise: number
  /** Personal message from sender. */
  message?: string
  /** 'PENDING' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'. */
  status: string
  /** ISO date — when the gift was sent. */
  createdAt: string
  /** ISO date — when the gift expires if not redeemed. */
  expiresAt: string
  /** ISO date — when the gift was redeemed (if status === 'REDEEMED'). */
  redeemedAt?: string
}

/** A group order (blueprint §20 Group Ordering). */
export interface GroupOrder {
  id: string
  hostId: string
  hostName: string
  hostAvatarUrl?: string
  restaurantId: string
  restaurantName: string
  restaurantImageUrl?: string
  /** 'OPEN' | 'LOCKED' | 'PLACED' | 'CANCELLED'. */
  status: string
  /** ISO date — when the group order was created. */
  createdAt: string
  /** ISO date — auto-close cutoff (host must checkout before this). */
  closesAt: string
  /** Member cap (blueprint suggests 8–12). */
  maxMembers?: number
  /** Total items across all member carts. */
  totalItems: number
  /** Target items before host checks out (drives progress bar). */
  targetItems?: number
}

/** A member of a group order (other than the host). */
export interface GroupOrderMember {
  id: string
  groupOrderId: string
  userId: string
  userName: string
  userAvatarUrl?: string
  /** Items this member has added to their portion of the cart. */
  itemCount: number
  /** Cart value in paise. */
  subtotalPaise: number
  /** 'JOINED' | 'LOCKED' | 'LEFT'. */
  status: string
  joinedAt: string
}

/** A single line item in a group order member's cart. */
export interface GroupOrderItem {
  id: string
  groupOrderId: string
  memberId: string
  menuItemId: string
  name: string
  pricePaise: number
  quantity: number
  subtotalPaise: number
  /** Optional modifier note ("Extra cheese, no onions"). */
  note?: string
}

/** A social connection between two consumers (blueprint §18 Social Graph).
 *
 * S1 Reconstruction: canonical field names match the server API response
 * from GET /api/social/connections. The server returns `userId` (the OTHER
 * user's id), `name`, `phone`, `avatarColor`, and status values
 * 'PENDING_SENT' | 'PENDING_RECEIVED' | 'ACCEPTED' | 'BLOCKED' | 'REJECTED'.
 * The old `friendId`/`friendName`/`friendAvatarUrl`/`friendCampusName` fields
 * and `PENDING_IN`/`PENDING_OUT` statuses have been removed — they caused
 * the Friends UI to never render pending requests. */
export interface SocialConnection {
  id: string
  /** The OTHER user's ID (the peer — friend or request sender). */
  userId: string
  /** The other user's display name. */
  name: string
  /** The other user's phone (for search/friend identification). */
  phone?: string
  /** Deterministic avatar color (derived from userId hash). */
  avatarColor?: string
  /** 'PENDING_SENT' | 'PENDING_RECEIVED' | 'ACCEPTED' | 'BLOCKED' | 'REJECTED'. */
  status: string
  /** 'sent' (I sent the request) or 'received' (they sent it to me). */
  direction?: 'sent' | 'received'
  /** Optional friend-request message. */
  message?: string | null
  /** ISO date — connection requested/accepted. */
  createdAt: string
  /** ISO date — connection accepted (if status === 'ACCEPTED'). */
  acceptedAt?: string | null
  /** S4A Unblock-UI-Reachability: The userId of the user who initiated the
   *  block (null for non-blocked or legacy rows). Exposed by GET
   *  /api/social/connections so the UI can determine whether the current user
   *  is the blocker (and thus authorized to see the Unblock control). */
  blockedBy?: string | null
}

/**
 * A Venmo-style social activity entry. CRITICAL: NEVER includes payment amount
 * (blueprint §6 P2 — Social should improve utility, not expose spending).
 *
 * S1 Reconstruction: verbs are UPPERCASE (ORDERED, EARNED_REWARD, GIFTED,
 * JOINED_GROUP, FRIEND_ADDED) matching the server's VERBS constant in
 * social-activity.ts. The server returns metadata as a JSON object — the
 * client projects restaurantName/dishName from it. visibility field added
 * to support PRIVATE filtering. likeCount/commentCount/likedByMe default
 * to 0/false at S1 (S2 will implement real persistence).
 */
export interface SocialActivity {
  id: string
  actorId: string
  actorName: string
  /** Deterministic avatar color (derived from actorId hash). */
  actorAvatarColor?: string
  actorAvatarUrl?: string
  /** Verb — UPPERCASE: 'ORDERED' | 'EARNED_REWARD' | 'GIFTED' |
   *  'JOINED_GROUP' | 'FRIEND_ADDED'. */
  verb: string
  /** Object type — 'Restaurant' | 'MenuItem' | 'Gift' | 'GroupOrder'. */
  objectType?: string
  /** Object ID (restaurantId, menuItemId, etc.). */
  objectId?: string
  /** Visibility — 'FRIENDS' | 'PUBLIC' | 'PRIVATE'. */
  visibility?: string
  /** Target restaurant (if any). */
  restaurantId?: string
  restaurantName?: string
  restaurantImageUrl?: string
  /** Target dish name (if any). */
  dishName?: string
  /** Optional dish thumbnail(s) for image carousel. */
  dishImageUrls?: string[]
  /** Optional target user (for gift/received_gift activities). */
  targetUserId?: string
  targetUserName?: string
  /** Raw metadata object (server returns this as JSON). */
  metadata?: Record<string, unknown>
  /** ISO timestamp. */
  createdAt: string
  /** Engagement counts (default 0 at S1 — S2 implements persistence). */
  likeCount?: number
  commentCount?: number
  /** Has the current user liked this activity? (default false at S1). */
  likedByMe?: boolean
}

/** A user notification (GJ-02 S3 — durable, bell + list). */
export interface Notification {
  id: string
  /** UPPERCASE type: FRIEND_REQUEST_RECEIVED | FRIEND_REQUEST_ACCEPTED |
   *  SOCIAL_ACTIVITY_LIKED | GIFT_RECEIVED | GIFT_REDEEMED | ORDER_ACCEPTED |
   *  REWARD_EARNED | GROUP_ORDER_CONFIRMED | GROUP_ORDER_CANCELLED | SYSTEM */
  type: string
  title: string
  body: string
  /** Parsed JSON data: { activityId?, likerId?, connectionId?, ... } */
  data: Record<string, unknown>
  /** ISO date string when read, or null if unread. */
  readAt: string | null
  /** Whether the user has read it. */
  read: boolean
  /** ISO timestamp. */
  createdAt: string
}
