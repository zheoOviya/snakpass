import { PrismaClient } from '@prisma/client'
import { db } from '../src/lib/db'

// Demo data for SnakZap. Prices in paise (₹1 = 100).
// Run with: bun run prisma/seed.ts

async function main() {
  console.log('Seeding SnakZap...')

  // Clean
  // PRODUCT FOUNDATION (PLAN-01) — disable FK enforcement during the delete
  // phase so we can clear tables in any order without tripping FK constraints.
  // Pre-existing seed deletes Order without first deleting Payment/Refund/
  // LedgerEntry rows (which FK-reference Order); without this disable, re-seed
  // fails with P2003 FK violation when prior app runtime testing left Payment
  // rows behind. FK is re-enabled below before any creates run.
  await db.$executeRawUnsafe('PRAGMA foreign_keys=OFF')

  // PRODUCT FOUNDATION (PLAN-01) — clear new tables FIRST (children before parents)
  // to avoid unique-constraint violations on re-seed.
  await db.rewardRedemption.deleteMany()
  await db.rewardLedgerEntry.deleteMany()
  await db.rewardAccount.deleteMany()
  await db.rewardRule.deleteMany()
  await db.groupOrderItem.deleteMany()
  await db.groupOrderMember.deleteMany()
  await db.groupOrder.deleteMany()
  await db.gift.deleteMany()
  await db.socialActivity.deleteMany()
  await db.socialConnection.deleteMany()
  await db.notification.deleteMany()
  await db.restaurantCampus.deleteMany()
  await db.campus.deleteMany()
  // Fulfilment table was created by the product_foundation_additive migration;
  // clear it too so re-seed is fully idempotent.
  await db.fulfilment.deleteMany()
  // Pre-existing FK children of Order/Payment — clear so existing
  // `order.deleteMany()` doesn't trip FK constraints on re-seed.
  await db.refund.deleteMany()
  await db.ledgerEntry.deleteMany()
  await db.payment.deleteMany()
  await db.remediationAction.deleteMany()
  await db.reconciliationFinding.deleteMany()
  await db.reconciliationRun.deleteMany()
  await db.exceptionQueue.deleteMany()
  await db.outbox.deleteMany()
  await db.processedEvent.deleteMany()
  await db.webhookEvent.deleteMany()
  await db.idempotencyKey.deleteMany()

  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.menuItem.deleteMany()
  await db.session.deleteMany()
  await db.otpRequest.deleteMany()
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.menuItem.deleteMany()
  await db.restaurant.deleteMany()
  await db.user.deleteMany()
  await db.auditLog.deleteMany()
  await db.killSwitch.deleteMany()

  // Re-enable FK for the create phase (enforces referential integrity on new rows).
  await db.$executeRawUnsafe('PRAGMA foreign_keys=ON')

  // Users — consumer + vendor use phone OTP; admin uses email+password+2FA OTP.
  // Demo admin password: admin123 (scrypt-hashed below).
  const { hashPassword } = await import('../src/lib/password')
  const consumer = await db.user.create({
    data: { phone: '+919876500001', name: 'Aarav Sharma', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 25000 },
  })
  const vendorOwner = await db.user.create({
    data: { phone: '+919876500002', name: 'Spice Junction Owner', role: 'VENDOR_OWNER', spiceTolerance: 4 },
  })
  const adminUser = await db.user.create({
    data: {
      phone: '+919876500003',
      email: 'admin@snakzap.com',
      passwordHash: await hashPassword('admin123'),
      name: 'Ops Admin',
      role: 'SUPER_ADMIN',
      spiceTolerance: 2,
    },
  })

  // Restaurants
  const r1 = await db.restaurant.create({
    data: {
      name: 'Spice Junction',
      cuisine: 'North Indian',
      description: 'Authentic Punjabi thalis, butter chicken & freshly baked naan. Pickup-only, ready in 20 mins.',
      image: '/images/r1.png',
      rating: 4.6,
      prepTimeMins: 22,
      priceForTwo: 45000,
      commissionRate: 0.08,
      address: 'Koramangala 5th Block, Bengaluru',
    },
  })
  const r2 = await db.restaurant.create({
    data: {
      name: 'Dosa Den',
      cuisine: 'South Indian',
      description: 'Crispy dosas, soft idlis & filter coffee. Pure-veg, fast pickup.',
      image: '/images/r2.png',
      rating: 4.7,
      prepTimeMins: 15,
      priceForTwo: 30000,
      commissionRate: 0.06,
      address: 'Indiranagar 100ft Road, Bengaluru',
    },
  })
  const r3 = await db.restaurant.create({
    data: {
      name: 'Wok & Roll',
      cuisine: 'Indo-Chinese',
      description: 'Sizzling manchurian, hakka noodles & chilli paneer. Bold flavours, quick pickup.',
      image: '/images/r3.png',
      rating: 4.3,
      prepTimeMins: 18,
      priceForTwo: 38000,
      commissionRate: 0.08,
      address: 'HSR Layout Sector 1, Bengaluru',
    },
  })
  const r4 = await db.restaurant.create({
    data: {
      name: 'Sweet Tooth Bakers',
      cuisine: 'Desserts',
      description: 'Artisanal cakes, pastries & filter coffee. Egg & eggless options.',
      image: '/images/r4.png',
      rating: 4.8,
      prepTimeMins: 10,
      priceForTwo: 25000,
      commissionRate: 0.05,
      address: 'Jayanagar 4th Block, Bengaluru',
    },
  })

  // Menu items (name, desc, price paise, spice, veg, category)
  type Dish = { name: string; desc: string; price: number; spice: number; veg: boolean; cat: string; img: string }
  const menus: Record<string, Dish[]> = {
    [r1.id]: [
      { name: 'Butter Chicken', desc: 'Tandoori chicken in rich tomato-butter gravy', price: 32000, spice: 2, veg: false, cat: 'Mains', img: '/images/svg/curry-chicken.svg' },
      { name: 'Paneer Tikka Masala', desc: 'Char-grilled paneer in spiced onion gravy', price: 28000, spice: 2, veg: true, cat: 'Mains', img: '/images/svg/curry-paneer.svg' },
      { name: 'Dal Makhani', desc: 'Slow-cooked black lentils, cream & butter', price: 22000, spice: 1, veg: true, cat: 'Mains', img: '/images/svg/dal.svg' },
      { name: 'Butter Naan', desc: 'Tandoor-baked flatbread brushed with butter', price: 6000, spice: 0, veg: true, cat: 'Breads', img: '/images/svg/naan.svg' },
      { name: 'Garlic Naan', desc: 'Naan topped with garlic & coriander', price: 8000, spice: 0, veg: true, cat: 'Breads', img: '/images/svg/naan-garlic.svg' },
      { name: 'Gulab Jamun (2 pcs)', desc: 'Warm milk dumplings in saffron syrup', price: 12000, spice: 0, veg: true, cat: 'Desserts', img: '/images/svg/gulab-jamun.svg' },
      { name: 'Sweet Lassi', desc: 'Chilled yogurt drink with cardamom', price: 9000, spice: 0, veg: true, cat: 'Beverages', img: '/images/svg/lassi.svg' },
    ],
    [r2.id]: [
      { name: 'Masala Dosa', desc: 'Crispy rice crepe with spiced potato', price: 14000, spice: 1, veg: true, cat: 'Mains', img: '/images/svg/dosa.svg' },
      { name: 'Idli Sambar (3 pcs)', desc: 'Steamed rice cakes with lentil stew', price: 11000, spice: 1, veg: true, cat: 'Mains', img: '/images/svg/idli.svg' },
      { name: 'Medu Vada (2 pcs)', desc: 'Crispy lentil donuts with chutney', price: 10000, spice: 1, veg: true, cat: 'Starters', img: '/images/svg/vada.svg' },
      { name: 'Uttapam', desc: 'Thick pancake with onion-tomato topping', price: 13000, spice: 1, veg: true, cat: 'Mains', img: '/images/svg/uttapam.svg' },
      { name: 'Filter Coffee', desc: 'South-style frothy decoction coffee', price: 6000, spice: 0, veg: true, cat: 'Beverages', img: '/images/svg/coffee.svg' },
      { name: 'Coconut Chutney Bowl', desc: 'Fresh coconut chutney with tempering', price: 4000, spice: 1, veg: true, cat: 'Starters', img: '/images/svg/chutney.svg' },
    ],
    [r3.id]: [
      { name: 'Chilli Paneer', desc: 'Indo-Chinese paneer in spicy soy glaze', price: 26000, spice: 3, veg: true, cat: 'Starters', img: '/images/svg/chilli-paneer.svg' },
      { name: 'Veg Hakka Noodles', desc: 'Wok-tossed noodles with crunchy veg', price: 22000, spice: 2, veg: true, cat: 'Mains', img: '/images/svg/noodles.svg' },
      { name: 'Gobi Manchurian', desc: 'Crispy cauliflower in tangy manchurian sauce', price: 20000, spice: 3, veg: true, cat: 'Starters', img: '/images/svg/manchurian.svg' },
      { name: 'Schezwan Fried Rice', desc: 'Spicy schezwan rice with vegetables', price: 21000, spice: 3, veg: true, cat: 'Mains', img: '/images/svg/fried-rice.svg' },
      { name: 'Chicken Chilli', desc: 'Battered chicken in spicy sauce', price: 30000, spice: 3, veg: false, cat: 'Starters', img: '/images/svg/chilli-chicken.svg' },
      { name: 'Spring Rolls (4 pcs)', desc: 'Crispy rolls with veg filling', price: 14000, spice: 1, veg: true, cat: 'Starters', img: '/images/svg/spring-roll.svg' },
    ],
    [r4.id]: [
      { name: 'Chocolate Truffle Pastry', desc: 'Rich dark chocolate ganache cake', price: 15000, spice: 0, veg: true, cat: 'Desserts', img: '/images/svg/pastry-choco.svg' },
      { name: 'Red Velvet Slice', desc: 'Moist red velvet with cream cheese', price: 16000, spice: 0, veg: true, cat: 'Desserts', img: '/images/svg/pastry-redvelvet.svg' },
      { name: 'Blueberry Cheesecake', desc: 'Baked cheesecake with blueberry compote', price: 18000, spice: 0, veg: true, cat: 'Desserts', img: '/images/svg/cheesecake.svg' },
      { name: 'Cappuccino', desc: 'Espresso with steamed milk foam', price: 10000, spice: 0, veg: true, cat: 'Beverages', img: '/images/svg/cappuccino.svg' },
      { name: 'Cold Coffee', desc: 'Blended iced coffee with ice cream', price: 12000, spice: 0, veg: true, cat: 'Beverages', img: '/images/svg/cold-coffee.svg' },
      { name: 'Croissant', desc: 'Flaky buttery French pastry', price: 9000, spice: 0, veg: true, cat: 'Desserts', img: '/images/svg/croissant.svg' },
    ],
  }

  for (const [rid, dishes] of Object.entries(menus)) {
    for (const d of dishes) {
      await db.menuItem.create({
        data: {
          restaurantId: rid,
          name: d.name,
          description: d.desc,
          price: d.price,
          image: d.img,
          spiceLevel: d.spice,
          isVeg: d.veg,
          category: d.cat,
        },
      })
    }
  }

  // Demo orders (various statuses)
  const now = Date.now()
  const mkOrder = async (
    rid: string,
    status: string,
    items: { name: string; price: number; qty: number }[],
    minsAgo: number,
    isCatering = false,
  ) => {
    const total = items.reduce((s, i) => s + i.price * i.qty, 0)
    const otp = String(Math.floor(100000 + Math.random() * 900000))
    const rest = await db.restaurant.findUnique({ where: { id: rid } })
    const firstItem = await db.menuItem.findFirst({ where: { restaurantId: rid, name: items[0].name } })
    const order = await db.order.create({
      data: {
        userId: consumer.id,
        restaurantId: rid,
        status,
        totalAmount: total,
        pickupOtp: otp,
        isCatering,
        headcount: isCatering ? 25 : null,
        itemsCount: items.reduce((s, i) => s + i.qty, 0),
        note: isCatering ? 'Catering for team lunch' : null,
        createdAt: new Date(now - minsAgo * 60000),
        statusHistory: JSON.stringify([
          { status: 'CONFIRMED', at: new Date(now - minsAgo * 60000).toISOString() },
          ...(status !== 'CONFIRMED' ? [{ status, at: new Date(now - Math.max(0, minsAgo - 5) * 60000).toISOString() }] : []),
        ]),
      },
    })
    for (const it of items) {
      const mi = await db.menuItem.findFirst({ where: { restaurantId: rid, name: it.name } })
      await db.orderItem.create({
        data: {
          orderId: order.id,
          menuItemId: mi?.id ?? firstItem!.id,
          name: it.name,
          price: it.price,
          quantity: it.qty,
          subtotal: it.price * it.qty,
          createdAt: order.createdAt,
        },
      })
    }
    return order
  }

  await mkOrder(r1.id, 'PREPARING', [{ name: 'Butter Chicken', price: 32000, qty: 1 }, { name: 'Butter Naan', price: 6000, qty: 2 }], 8)
  await mkOrder(r1.id, 'READY_FOR_PICKUP', [{ name: 'Paneer Tikka Masala', price: 28000, qty: 1 }, { name: 'Garlic Naan', price: 8000, qty: 2 }], 14)
  await mkOrder(r2.id, 'CONFIRMED', [{ name: 'Masala Dosa', price: 14000, qty: 2 }, { name: 'Filter Coffee', price: 6000, qty: 2 }], 3)
  await mkOrder(r2.id, 'PICKED_UP', [{ name: 'Idli Sambar (3 pcs)', price: 11000, qty: 1 }], 40)
  await mkOrder(r3.id, 'ALMOST_READY', [{ name: 'Chilli Paneer', price: 26000, qty: 1 }, { name: 'Veg Hakka Noodles', price: 22000, qty: 1 }], 11)
  await mkOrder(r3.id, 'PICKED_UP', [{ name: 'Chicken Chilli', price: 30000, qty: 1 }, { name: 'Spring Rolls (4 pcs)', price: 14000, qty: 1 }], 65)
  await mkOrder(r4.id, 'READY_FOR_PICKUP', [{ name: 'Chocolate Truffle Pastry', price: 15000, qty: 2 }, { name: 'Cold Coffee', price: 12000, qty: 1 }], 6)
  await mkOrder(r4.id, 'PICKED_UP', [{ name: 'Red Velvet Slice', price: 16000, qty: 1 }], 90)
  await mkOrder(r1.id, 'CONFIRMED', [{ name: 'Dal Makhani', price: 22000, qty: 1 }, { name: 'Butter Naan', price: 6000, qty: 3 }], 1, true)

  // Kill switches
  await db.killSwitch.createMany({
    data: [
      { key: 'ordering', label: 'Order Intake', description: 'Disable new order placement platform-wide', enabled: false, severity: 'CRITICAL' },
      { key: 'payments', label: 'Payments', description: 'Halt payment collection (checkout disabled)', enabled: false, severity: 'CRITICAL' },
      { key: 'catering', label: 'Catering Orders', description: 'Block B2B/catering order creation', enabled: false, severity: 'HIGH' },
      { key: 'new_vendors', label: 'Vendor Onboarding', description: 'Pause new vendor sign-ups', enabled: false, severity: 'MEDIUM' },
      { key: 'wallet_cashback', label: 'Wallet Cashback', description: 'Suspend 1% cashback credits', enabled: false, severity: 'LOW' },
    ],
  })

  // Audit logs (with hash-chain tamper-evidence per DEV-001)
  const { createHash } = await import('crypto')
  const auditEntries = [
    { actorId: adminUser.id, actorRole: 'SUPER_ADMIN', action: 'ADMIN_LOGIN', metadata: JSON.stringify({ ip: '127.0.0.1' }), createdAt: new Date(now - 120 * 60000) },
    { actorId: adminUser.id, actorRole: 'SUPER_ADMIN', action: 'VENDOR_SUSPEND', metadata: JSON.stringify({ restaurantId: r3.id, reason: 'Delayed pickups' }), createdAt: new Date(now - 90 * 60000) },
    { actorId: adminUser.id, actorRole: 'SUPER_ADMIN', action: 'KILL_SWITCH_TOGGLE', metadata: JSON.stringify({ key: 'payments', enabled: false }), createdAt: new Date(now - 60 * 60000) },
    { actorId: adminUser.id, actorRole: 'SUPER_ADMIN', action: 'KILL_SWITCH_TOGGLE', metadata: JSON.stringify({ key: 'payments', enabled: true }), createdAt: new Date(now - 58 * 60000) },
    { actorId: vendorOwner.id, actorRole: 'VENDOR_OWNER', action: 'MENU_AVAILABILITY', metadata: JSON.stringify({ item: 'Butter Chicken', available: true }), createdAt: new Date(now - 30 * 60000) },
    { actorId: adminUser.id, actorRole: 'SUPER_ADMIN', action: 'ORDER_OVERRIDE', metadata: JSON.stringify({ orderId: 'demo', to: 'PICKED_UP' }), createdAt: new Date(now - 15 * 60000) },
  ]
  let prevHash = 'GENESIS'
  for (const entry of auditEntries) {
    const id = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const hash = createHash('sha256').update(`${prevHash}|${id}|${entry.actorId}|${entry.actorRole}|${entry.action}|${entry.metadata}|${entry.createdAt.toISOString()}`).digest('hex')
    await db.auditLog.create({ data: { id, ...entry, prevHash, hash } })
    prevHash = hash
  }

  // ==========================================================================
  // PRODUCT FOUNDATION (PLAN-01) — Wave 1 Task 1A seed additions
  // ==========================================================================
  // All seed data below is APPEND-ONLY (existing seed rows untouched above).
  // Adds: campuses, restaurant-campus links, restaurant.ownerUserId, reward
  // rules, reward account + ledger entries, sample gifts, sample group order,
  // social activity feed, notifications.
  // ==========================================================================

  // ---------- Campuses (4) ----------
  // 4 campuses across Indian cities. Only IIM-Bangalore + Christ are linked
  // to restaurants below (Bengaluru restaurants); IIT-Bombay + BITS-Pilani
  // exist as seed rows so the campus selector has multiple options.
  await db.campus.create({
    data: {
      name: 'IIT Bombay',
      shortName: 'IIT-B',
      domain: 'iitb.ac.in',
      city: 'Mumbai',
      state: 'MH',
      pincode: '400076',
      isActive: true,
    },
  })
  const campusIIMB = await db.campus.create({
    data: {
      name: 'IIM Bangalore',
      shortName: 'IIM-B',
      domain: 'iimb.ac.in',
      city: 'Bengaluru',
      state: 'KA',
      pincode: '560076',
      isActive: true,
    },
  })
  await db.campus.create({
    data: {
      name: 'BITS Pilani',
      shortName: 'BITS',
      domain: 'bits-pilani.ac.in',
      city: 'Pilani',
      state: 'RJ',
      pincode: '333031',
      isActive: true,
    },
  })
  const campusChrist = await db.campus.create({
    data: {
      name: 'Christ University',
      shortName: 'Christ',
      domain: 'christuniversity.in',
      city: 'Bengaluru',
      state: 'KA',
      pincode: '560029',
      isActive: true,
    },
  })

  // ---------- Restaurant.ownerUserId + RestaurantCampus junction ----------
  // Set ownerUserId on all existing restaurants to the vendorOwner demo user
  // (governance: ownerUserId is a soft FK — see schema comment).
  await db.restaurant.update({ where: { id: r1.id }, data: { ownerUserId: vendorOwner.id, campusId: campusIIMB.id } })
  await db.restaurant.update({ where: { id: r2.id }, data: { ownerUserId: vendorOwner.id, campusId: campusIIMB.id } })
  await db.restaurant.update({ where: { id: r3.id }, data: { ownerUserId: vendorOwner.id, campusId: campusIIMB.id } })
  await db.restaurant.update({ where: { id: r4.id }, data: { ownerUserId: vendorOwner.id, campusId: campusIIMB.id } })

  // Restaurant-campus junction (many-to-many; primary marked with isPrimary=true)
  await db.restaurantCampus.create({ data: { restaurantId: r1.id, campusId: campusIIMB.id, isPrimary: true } })
  await db.restaurantCampus.create({ data: { restaurantId: r2.id, campusId: campusIIMB.id, isPrimary: true } })
  await db.restaurantCampus.create({ data: { restaurantId: r2.id, campusId: campusChrist.id, isPrimary: false } })
  await db.restaurantCampus.create({ data: { restaurantId: r3.id, campusId: campusIIMB.id, isPrimary: true } })
  await db.restaurantCampus.create({ data: { restaurantId: r4.id, campusId: campusIIMB.id, isPrimary: true } })
  await db.restaurantCampus.create({ data: { restaurantId: r4.id, campusId: campusChrist.id, isPrimary: false } })

  // Link consumer to campus (IIM Bangalore — same campus as the restaurants)
  await db.user.update({ where: { id: consumer.id }, data: { campusId: campusIIMB.id } })

  // ---------- Reward rules (6) ----------
  // pointsFormula is a JSON string interpreted by src/lib/rewards-engine.ts
  // (Wave 5 Task 5A). For seed, we use the documented format.
  const ruleFirstOrder = await db.rewardRule.create({
    data: {
      key: 'first_order',
      name: 'First Order Bonus',
      description: '50 points awarded on your first completed order',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 50 }),
      isActive: true,
    },
  })
  const ruleStreak3 = await db.rewardRule.create({
    data: {
      key: 'order_streak_3',
      name: '3-Day Order Streak',
      description: '30 points awarded when you order 3 days in a row',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 30 }),
      isActive: true,
    },
  })
  const ruleOffPeak = await db.rewardRule.create({
    data: {
      key: 'off_peak_order',
      name: 'Off-Peak Order',
      description: '20 points awarded for orders placed during off-peak hours (3-5 PM)',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 20 }),
      isActive: true,
    },
  })
  const ruleGroupOrder = await db.rewardRule.create({
    data: {
      key: 'group_order',
      name: 'Group Order Bonus',
      description: '40 points awarded when your group order is confirmed',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 40 }),
      isActive: true,
    },
  })
  const ruleGiftSent = await db.rewardRule.create({
    data: {
      key: 'gift_sent',
      name: 'Gift Sent',
      description: '25 points awarded when you send a gift to a friend',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 25 }),
      isActive: true,
    },
  })
  const ruleReferral = await db.rewardRule.create({
    data: {
      key: 'referral',
      name: 'Referral Bonus',
      description: '100 points awarded when a friend places their first order using your referral code',
      pointsFormula: JSON.stringify({ type: 'fixed', points: 100 }),
      isActive: true,
    },
  })

  // ---------- Demo consumers (friends of Aarav — for gifts + social graph) ----------
  const friendPriya = await db.user.create({
    data: { phone: '+919876500011', name: 'Priya Patel', role: 'CONSUMER', spiceTolerance: 2, walletBalance: 12000, campusId: campusIIMB.id },
  })
  const friendRahul = await db.user.create({
    data: { phone: '+919876500012', name: 'Rahul Mehta', role: 'CONSUMER', spiceTolerance: 4, walletBalance: 8000, campusId: campusIIMB.id },
  })

  // ---------- Reward account for Aarav (consumer) ----------
  // Sample balance = 265 pts (sum of 6 EARN ledger entries below).
  // lifetimeEarned = 265, lifetimeRedeemed = 0 (no demo redemptions).
  await db.rewardAccount.create({
    data: {
      userId: consumer.id,
      balance: 265,
      lifetimeEarned: 265,
      lifetimeRedeemed: 0,
    },
  })

  // ---------- Reward ledger entries (6 EARN entries tied to existing orders) ----------
  // idempotencyKey format: `${ruleKey}:${eventId}` (per plan §3.1 + rewards-engine.ts).
  const consumerOrders = await db.order.findMany({
    where: { userId: consumer.id },
    orderBy: { createdAt: 'asc' },
    take: 5,
  })

  // Lookup menu items for gift snapshots
  const miTruffle = await db.menuItem.findFirst({ where: { restaurantId: r4.id, name: 'Chocolate Truffle Pastry' } })
  const miDosa = await db.menuItem.findFirst({ where: { restaurantId: r2.id, name: 'Masala Dosa' } })

  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 50,
      orderId: consumerOrders[0]?.id ?? null,
      ruleId: ruleFirstOrder.id,
      idempotencyKey: 'first_order:seed-001',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000), // 1 year expiry
    },
  })
  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 30,
      orderId: consumerOrders[1]?.id ?? null,
      ruleId: ruleStreak3.id,
      idempotencyKey: 'order_streak_3:seed-002',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    },
  })
  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 20,
      orderId: consumerOrders[2]?.id ?? null,
      ruleId: ruleOffPeak.id,
      idempotencyKey: 'off_peak_order:seed-003',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    },
  })
  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 25,
      ruleId: ruleGiftSent.id,
      idempotencyKey: 'gift_sent:seed-004',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    },
  })
  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 100,
      ruleId: ruleReferral.id,
      referralUserId: friendPriya.id,
      idempotencyKey: 'referral:seed-005',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    },
  })
  // The 6th EARN entry references the group order created below — placeholder
  // orderId null (groupOrderId will be set after GroupOrder is created).

  // ---------- Sample gifts (2, status AVAILABLE, future expiresAt) ----------
  // Gift 1: Aarav → Priya, Chocolate Truffle Pastry from Sweet Tooth Bakers
  // Gift 2: Aarav → Rahul, Masala Dosa from Dosa Den
  const gift1 = await db.gift.create({
    data: {
      senderId: consumer.id,
      recipientId: friendPriya.id,
      menuItemId: miTruffle!.id,
      menuItemName: 'Chocolate Truffle Pastry',
      menuItemPrice: 15000,
      message: 'Happy birthday Priya! Treat yourself 🎂',
      status: 'AVAILABLE',
      redemptionCode: 'SNZ-GIFT-PRIYA-001',
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      paidAt: new Date(now - 2 * 24 * 60 * 60 * 1000), // paid 2 days ago
      availableAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      // paymentId is a soft FK — placeholder string for demo (no real Payment row)
      paymentId: 'demo_pay_gift_001',
    },
  })
  await db.gift.create({
    data: {
      senderId: consumer.id,
      recipientId: friendRahul.id,
      menuItemId: miDosa!.id,
      menuItemName: 'Masala Dosa',
      menuItemPrice: 14000,
      message: 'Thanks for helping with the assignment! 🙏',
      status: 'AVAILABLE',
      redemptionCode: 'SNZ-GIFT-RAHUL-002',
      expiresAt: new Date(now + 25 * 24 * 60 * 60 * 1000), // 25 days from now
      paidAt: new Date(now - 5 * 60 * 60 * 1000), // paid ~5 hours ago
      availableAt: new Date(now - 5 * 60 * 60 * 1000),
      paymentId: 'demo_pay_gift_002',
    },
  })

  // ---------- Sample group order (1, status OPEN) ----------
  // Host=Aarav, restaurant=Dosa Den, 2 members (Aarav + Priya), 2 items.
  // shareCode is a 6-character human-readable code.
  const groupOrder = await db.groupOrder.create({
    data: {
      hostId: consumer.id,
      restaurantId: r2.id,
      status: 'OPEN',
      shareCode: 'AB12CD',
      closesAt: new Date(now + 24 * 60 * 60 * 1000), // closes in 24h
      name: 'Tuesday lunch — Dosa Den',
      version: 0,
    },
  })
  // Members: host + 1 friend
  await db.groupOrderMember.create({
    data: { groupOrderId: groupOrder.id, userId: consumer.id },
  })
  await db.groupOrderMember.create({
    data: { groupOrderId: groupOrder.id, userId: friendPriya.id },
  })
  // Items: Aarav wants 2 Masala Dosas; Priya wants 1 Idli Sambar
  await db.groupOrderItem.create({
    data: {
      groupOrderId: groupOrder.id,
      userId: consumer.id,
      menuItemId: miDosa!.id,
      name: 'Masala Dosa',
      price: 14000,
      quantity: 2,
    },
  })
  const miIdli = await db.menuItem.findFirst({ where: { restaurantId: r2.id, name: 'Idli Sambar (3 pcs)' } })
  await db.groupOrderItem.create({
    data: {
      groupOrderId: groupOrder.id,
      userId: friendPriya.id,
      menuItemId: miIdli!.id,
      name: 'Idli Sambar (3 pcs)',
      price: 11000,
      quantity: 1,
    },
  })

  // 6th EARN ledger entry — GROUP_ORDER bonus tied to the group order created above.
  await db.rewardLedgerEntry.create({
    data: {
      userId: consumer.id,
      type: 'EARN',
      points: 40,
      ruleId: ruleGroupOrder.id,
      groupOrderId: groupOrder.id,
      idempotencyKey: 'group_order:seed-006',
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
    },
  })

  // ---------- Sample social activities (5) ----------
  // NEVER include payment amounts in metadata (governance: blueprint §18).
  // Each entry records WHO did WHAT with WHICH object — no money.
  await db.socialActivity.create({
    data: {
      actorId: consumer.id,
      verb: 'ordered_from',
      objectType: 'Restaurant',
      objectId: r2.id,
      metadata: JSON.stringify({ restaurantName: 'Dosa Den', cuisine: 'South Indian' }),
      visibility: 'FRIENDS',
      createdAt: new Date(now - 3 * 60 * 60 * 1000), // 3h ago
    },
  })
  await db.socialActivity.create({
    data: {
      actorId: consumer.id,
      verb: 'earned_reward',
      objectType: 'RewardLedgerEntry',
      objectId: ruleFirstOrder.id,
      metadata: JSON.stringify({ ruleKey: 'first_order', ruleName: 'First Order Bonus', pointsEarned: 50 }),
      visibility: 'FRIENDS',
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    },
  })
  await db.socialActivity.create({
    data: {
      actorId: consumer.id,
      verb: 'gifted',
      objectType: 'Gift',
      objectId: gift1.id,
      metadata: JSON.stringify({ recipientName: 'Priya Patel', menuItemName: 'Chocolate Truffle Pastry' }),
      visibility: 'FRIENDS',
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
  })
  await db.socialActivity.create({
    data: {
      actorId: friendPriya.id,
      verb: 'joined_group',
      objectType: 'GroupOrder',
      objectId: groupOrder.id,
      metadata: JSON.stringify({ hostName: 'Aarav Sharma', restaurantName: 'Dosa Den', groupName: 'Tuesday lunch' }),
      visibility: 'FRIENDS',
      createdAt: new Date(now - 60 * 60 * 1000), // 1h ago
    },
  })
  await db.socialActivity.create({
    data: {
      actorId: consumer.id,
      verb: 'ordered_from',
      objectType: 'Restaurant',
      objectId: r4.id,
      metadata: JSON.stringify({ restaurantName: 'Sweet Tooth Bakers', cuisine: 'Desserts' }),
      visibility: 'PUBLIC',
      createdAt: new Date(now - 6 * 60 * 60 * 1000), // 6h ago
    },
  })

  // ---------- Sample social connections (2 — Aarav ↔ Priya ACCEPTED, Aarav → Rahul PENDING) ----------
  await db.socialConnection.create({
    data: {
      followerId: consumer.id,
      followeeId: friendPriya.id,
      status: 'ACCEPTED',
      requestedAt: new Date(now - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      acceptedAt: new Date(now - 6 * 24 * 60 * 60 * 1000),
    },
  })
  // Reverse direction (bidirectional — Priya follows Aarav too)
  await db.socialConnection.create({
    data: {
      followerId: friendPriya.id,
      followeeId: consumer.id,
      status: 'ACCEPTED',
      requestedAt: new Date(now - 7 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(now - 6 * 24 * 60 * 60 * 1000),
    },
  })
  // Pending request: Rahul → Aarav
  await db.socialConnection.create({
    data: {
      followerId: friendRahul.id,
      followeeId: consumer.id,
      status: 'PENDING',
      requestedAt: new Date(now - 30 * 60 * 1000), // 30 min ago
      message: 'Hey Aarav, let\'s connect on SnakZap!',
    },
  })

  // ---------- Sample notifications (4 for Aarav, 2 for Priya) ----------
  await db.notification.create({
    data: {
      userId: consumer.id,
      type: 'ORDER_READY',
      title: 'Your order is ready for pickup',
      body: 'Dosa Den — Masala Dosa + Filter Coffee. Show pickup OTP at counter.',
      data: JSON.stringify({ orderId: consumerOrders[0]?.id ?? null, restaurantName: 'Dosa Den' }),
      readAt: null,
      createdAt: new Date(now - 10 * 60 * 1000), // 10 min ago
    },
  })
  await db.notification.create({
    data: {
      userId: consumer.id,
      type: 'GIFT_RECEIVED',
      title: 'You received a gift!',
      body: 'Aarav sent you a Chocolate Truffle Pastry. Tap to redeem.',
      data: JSON.stringify({ senderName: 'Aarav Sharma', giftId: gift1.id }),
      readAt: null,
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
  })
  await db.notification.create({
    data: {
      userId: consumer.id,
      type: 'REWARD_EARNED',
      title: 'You earned 50 reward points',
      body: 'First Order Bonus added to your account. Total: 265 pts.',
      data: JSON.stringify({ points: 50, ruleKey: 'first_order', newBalance: 265 }),
      readAt: new Date(now - 60 * 60 * 1000), // read 1h ago
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
    },
  })
  await db.notification.create({
    data: {
      userId: consumer.id,
      type: 'FRIEND_REQUEST',
      title: 'New friend request',
      body: 'Rahul Mehta wants to connect with you on SnakZap.',
      data: JSON.stringify({ fromUserId: friendRahul.id, fromUserName: 'Rahul Mehta' }),
      readAt: null,
      createdAt: new Date(now - 30 * 60 * 1000),
    },
  })
  // Priya's notifications
  await db.notification.create({
    data: {
      userId: friendPriya.id,
      type: 'GIFT_RECEIVED',
      title: 'Aarav sent you a gift!',
      body: 'Chocolate Truffle Pastry from Sweet Tooth Bakers. Redeem within 30 days.',
      data: JSON.stringify({ senderName: 'Aarav Sharma', giftId: gift1.id }),
      readAt: null,
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
  })
  await db.notification.create({
    data: {
      userId: friendPriya.id,
      type: 'GROUP_ORDER_INVITE',
      title: 'Aarav invited you to a group order',
      body: 'Tuesday lunch at Dosa Den. Add your items before the host confirms.',
      data: JSON.stringify({ hostName: 'Aarav Sharma', restaurantName: 'Dosa Den', groupOrderId: groupOrder.id }),
      readAt: null,
      createdAt: new Date(now - 90 * 60 * 1000),
    },
  })

  // ---------- Fulfilment rows for existing demo orders ----------
  // Lazy-create Fulfilment rows for the demo orders so the vendor console can
  // advance them (the Fulfilment table was created in this migration; pre-existing
  // orders don't have Fulfilment rows yet). For PICKED_UP orders, set status=PICKED_UP.
  // For others, set status based on the Order.status (parallel state machine).
  const allDemoOrders = await db.order.findMany({ where: { userId: consumer.id } })
  for (const o of allDemoOrders) {
    // Map Order.status → Fulfilment.status (parallel machines, same vocab except CONFIRMED→PREPARING)
    let fStatus = 'PREPARING'
    if (o.status === 'ALMOST_READY') fStatus = 'ALMOST_READY'
    else if (o.status === 'READY_FOR_PICKUP') fStatus = 'READY_FOR_PICKUP'
    else if (o.status === 'PICKED_UP') fStatus = 'PICKED_UP'
    else fStatus = 'PREPARING' // CONFIRMED, PREPARING, PAID, CANCELLED, PAYMENT_PENDING → PREPARING
    await db.fulfilment.create({
      data: {
        orderId: o.id,
        status: fStatus,
        pickupOtp: o.pickupOtp,
        // acceptedAt: set only for non-PICKED_UP orders (vendor acknowledged)
        acceptedAt: o.status === 'CONFIRMED' ? null : new Date(o.createdAt.getTime() + 60 * 1000), // 1 min after order placed
      },
    }).catch(() => {
      // Ignore if Fulfilment already exists for this order (idempotent)
    })
  }

  console.log('Seeded:')
  console.log('  - 4 restaurants, ~25 menu items')
  console.log('  - 9 demo orders across statuses')
  console.log('  - 5 kill switches, 6 audit logs')
  console.log('  - PRODUCT FOUNDATION: 4 campuses, 6 reward rules, 1 reward account (265 pts)')
  console.log('  - PRODUCT FOUNDATION: 2 gifts (AVAILABLE), 1 group order (OPEN, 2 members, 2 items)')
  console.log('  - PRODUCT FOUNDATION: 5 social activities, 3 social connections, 6 notifications')
  console.log('  - PRODUCT FOUNDATION: Fulfilment rows for demo orders, 2 demo consumer friends')
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
