import { PrismaClient } from '@prisma/client'
import { db } from '../src/lib/db'

// Demo data for SnakZap. Prices in paise (₹1 = 100).
// Run with: bun run prisma/seed.ts

async function main() {
  console.log('Seeding SnakZap...')

  // Clean — drop WORM triggers (prevent_audit_update/delete) so we can clear
  // audit contamination, then delete audit logs FIRST (FK: auditLog.actorId → user.id)
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS prevent_audit_update')
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS prevent_audit_delete')
  await db.auditLog.deleteMany()
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
  await db.killSwitch.deleteMany()

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

  console.log('Seeded:')
  console.log('  - 4 restaurants, ~25 menu items')
  console.log('  - 9 demo orders across statuses')
  console.log('  - 5 kill switches, 6 audit logs')

  // Re-create WORM triggers (append-only enforcement at the storage level).
  // These triggers were dropped at the start of seed to allow audit cleanup.
  // In production they prevent any UPDATE or DELETE on AuditLog.
  await db.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
    BEFORE UPDATE ON AuditLog
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_WORM: UPDATE rejected — audit log is append-only');
    END
  `)
  await db.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
    BEFORE DELETE ON AuditLog
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_WORM: DELETE rejected — audit log is append-only');
    END
  `)
  console.log('  - WORM triggers re-created (append-only enforced)')
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
