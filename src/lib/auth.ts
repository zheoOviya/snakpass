import { db } from './db'

// Demo "current user" resolution. In the original SnakZap this used OTP+JWT.
// Here we resolve the seeded consumer/vendor/admin demo accounts by role.

export async function getConsumerId(): Promise<string> {
  const u = await db.user.findFirst({ where: { role: 'CONSUMER' } })
  return u!.id
}

export async function getAdminId(): Promise<string> {
  const u = await db.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
  return u!.id
}

export async function getConsumer() {
  return db.user.findFirst({ where: { role: 'CONSUMER' } })
}
