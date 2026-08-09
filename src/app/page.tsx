'use client'

import { useState } from 'react'
import { Moon, Sun, Utensils, Store, ShieldCheck, Zap } from 'lucide-react'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConsumerView } from '@/components/snak/consumer-view'
import { VendorView } from '@/components/snak/vendor-view'
import { AdminView } from '@/components/snak/admin-view'

type Persona = 'consumer' | 'vendor' | 'admin'

const PERSONAS: { id: Persona; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'consumer', label: 'Consumer', icon: <Utensils className="h-4 w-4" />, desc: 'Order & track pickup' },
  { id: 'vendor', label: 'Vendor', icon: <Store className="h-4 w-4" />, desc: 'Kitchen & menu' },
  { id: 'admin', label: 'Ops Admin', icon: <ShieldCheck className="h-4 w-4" />, desc: 'Governance & metrics' },
]

export default function Home() {
  const [persona, setPersona] = useState<Persona>('consumer')
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
              <Zap className="h-5 w-5" fill="currentColor" />
            </div>
            <div className="leading-none">
              <h1 className="text-lg font-bold tracking-tight">Snak<span className="text-teal-600">Zap</span></h1>
              <p className="hidden text-[10px] text-muted-foreground sm:block">Pickup-first food ordering</p>
            </div>
          </div>

          <Tabs value={persona} onValueChange={(v) => setPersona(v as Persona)}>
            <TabsList className="h-9">
              {PERSONAS.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className="gap-1.5 text-xs sm:text-sm">
                  {p.icon}
                  <span className="hidden sm:inline">{p.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </Button>
        </div>
      </header>

      {/* Persona subtitle */}
      <div className="border-b bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-2">
          {PERSONAS.map((p) => (
            persona === p.id && (
              <motion.p
                key={p.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                {p.icon}
                <span className="font-medium text-foreground">{p.label}</span>
                <span>— {p.desc}</span>
              </motion.p>
            )
          ))}
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl flex-1">
        {persona === 'consumer' && <ConsumerView />}
        {persona === 'vendor' && <VendorView />}
        {persona === 'admin' && <AdminView />}
      </main>

      {/* Footer (sticky bottom) */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
              <Zap className="h-3.5 w-3.5" fill="currentColor" />
            </div>
            <span><strong className="text-foreground">SnakZap</strong> — Pickup-first food ordering platform</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>🎯 North Star: <strong className="text-foreground">Time from order to first bite</strong></span>
            <span>🚫 No delivery</span>
            <span>💳 Max 10% commission</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
