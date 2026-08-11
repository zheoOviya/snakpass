'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Utensils, Store, ShieldCheck, Zap, ArrowRight, Clock, MapPin, ShieldCheck as Badge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const PORTALS = [
  {
    href: '/?XTransformPort=3006',
    title: 'Consumer',
    desc: 'Order ahead, pay digitally & pick up without waiting. Live kitchen tracking.',
    icon: <Utensils className="h-7 w-7" />,
    gradient: 'from-teal-500 to-emerald-600',
    cta: 'Order food',
    features: ['OTP phone login', 'Real-time order tracking', 'QR + OTP pickup'],
    port: '3006',
  },
  {
    href: '/?XTransformPort=3007',
    title: 'Vendor',
    desc: 'Run your live kitchen — accept orders, manage menu & advance prep status.',
    icon: <Store className="h-7 w-7" />,
    gradient: 'from-orange-500 to-amber-600',
    cta: 'Open kitchen',
    features: ['OTP phone login', 'Live order queue', 'Menu availability'],
    port: '3007',
  },
  {
    href: '/?XTransformPort=3008',
    title: 'Ops Admin',
    desc: 'Governance console — metrics, kill switches, audit trail & order oversight.',
    icon: <ShieldCheck className="h-7 w-7" />,
    gradient: 'from-slate-700 to-slate-900',
    cta: 'Open console',
    features: ['Email + 2FA login', 'Kill switches', 'Audit trail'],
    port: '3008',
  },
]

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-teal-50/40 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
              <Zap className="h-5 w-5" fill="currentColor" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Snak<span className="text-teal-600">Zap</span></h1>
              <p className="-mt-0.5 text-[11px] text-muted-foreground">Pickup-first food ordering</p>
            </div>
          </div>
          <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Avg pickup 18 min</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Bengaluru</span>
            <span className="inline-flex items-center gap-1"><Badge className="h-3.5 w-3.5" /> 100% digital</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-emerald-600 to-teal-700 p-8 text-white shadow-xl sm:p-12"
        >
          <h2 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
            Pickup-first. Zero waiting. <span className="text-teal-100">Time from order to first bite.</span>
          </h2>
          <p className="mt-3 max-w-xl text-teal-50/90">
            SnakZap is an Indian-market food ordering platform with three dedicated portals. Consumers
            order ahead with OTP login, vendors run live kitchens, and ops governs everything with a
            2FA-secured console.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/20 px-3 py-1">🔥 Firebase OTP auth</span>
            <span className="rounded-full bg-white/20 px-3 py-1">⚡ Real-time order tracking</span>
            <span className="rounded-full bg-white/20 px-3 py-1">🔒 Admin 2FA</span>
            <span className="rounded-full bg-white/20 px-3 py-1">🚫 No delivery</span>
          </div>
        </motion.div>

        {/* Portal cards */}
        <div className="grid gap-5 md:grid-cols-3">
          {PORTALS.map((p, i) => (
            <motion.div
              key={p.href}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
            >
              <Link href={p.href} className="group block h-full">
                <Card className="h-full overflow-hidden border-border/60 transition group-hover:shadow-lg group-hover:-translate-y-1">
                  <div className={`flex items-center gap-3 bg-gradient-to-br ${p.gradient} p-5 text-white`}>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                      {p.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold">{p.title}</h3>
                    </div>
                    <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-mono font-semibold">
                      :{p.port}
                    </span>
                  </div>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">{p.desc}</p>
                    <ul className="mt-3 space-y-1.5">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button className="mt-4 w-full" variant="outline">
                      {p.cta} <ArrowRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Demo credentials */}
        <div className="mt-8 rounded-2xl border border-dashed bg-muted/30 p-5">
          <h3 className="mb-2 text-sm font-semibold">Demo credentials — each portal on its own port</h3>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-teal-700 dark:text-teal-300">Consumer</p>
                <span className="font-mono text-[10px] text-muted-foreground">port 3006</span>
              </div>
              <p className="mt-1 text-muted-foreground">Phone OTP login</p>
              <p className="font-mono text-foreground">+919876500001</p>
            </div>
            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-orange-700 dark:text-orange-300">Vendor</p>
                <span className="font-mono text-[10px] text-muted-foreground">port 3007</span>
              </div>
              <p className="mt-1 text-muted-foreground">Phone OTP login</p>
              <p className="font-mono text-foreground">+919876500002</p>
            </div>
            <div className="rounded-lg bg-background p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-700 dark:text-slate-300">Ops Admin</p>
                <span className="font-mono text-[10px] text-muted-foreground">port 3008</span>
              </div>
              <p className="mt-1 text-muted-foreground">Email + 2FA</p>
              <p className="font-mono text-foreground">admin@snakzap.com</p>
              <p className="font-mono text-foreground">admin123</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Demo mode shows the OTP/2FA code on screen. Configure <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> env vars to enable real SMS/email delivery via Firebase Authentication.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <span><strong className="text-foreground">SnakZap</strong> — Pickup-first food ordering platform · Firebase Authentication</span>
          <div className="flex gap-3">
            <span>🚫 No delivery</span>
            <span>💳 Max 10% commission</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
