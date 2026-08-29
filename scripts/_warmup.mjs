#!/usr/bin/env bun
// Lightweight route warmup — compiles pickup-verify + fulfilment routes
// with a valid session so the first real evidence fetch doesn't spike memory.
import { Database } from 'bun:sqlite'
import { randomBytes } from 'crypto'
const db = new Database('/home/z/my-project/db/custom.db')
const id = () => randomBytes(12).toString('hex')
const token = randomBytes(32).toString('hex')
const csrf = randomBytes(32).toString('hex')
const uid = id()
const now = new Date().toISOString()
db.run('INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)', [uid, '+919900000099', 'VENDOR_OWNER', 'warmup', 3, 0, now])
db.run('INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)', [token, uid, 'VENDOR_OWNER', new Date(Date.now()+86400000).toISOString(), now, now])
const h = { 'Content-Type': 'application/json', Cookie: `snakzap_session=${token}; snakzap_csrf=${csrf}`, 'X-CSRF-Token': csrf }
// compile GET fulfilment
let r = await fetch('http://localhost:3000/api/orders/nonexistent/fulfilment', { headers: h })
console.log('warm GET fulfilment:', r.status)
// compile PATCH fulfilment
r = await fetch('http://localhost:3000/api/orders/nonexistent/fulfilment', { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'PREPARING' }) })
console.log('warm PATCH fulfilment:', r.status)
// compile POST pickup/verify (repaired route)
r = await fetch('http://localhost:3000/api/orders/nonexistent/pickup/verify', { method: 'POST', headers: h, body: JSON.stringify({ otpId: 'w', code: '000000' }) })
console.log('warm POST pickup/verify:', r.status)
db.run('DELETE FROM Session WHERE userId = ?', [uid])
db.run('DELETE FROM User WHERE id = ?', [uid])
db.close()
