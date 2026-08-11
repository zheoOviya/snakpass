'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Phone, ShieldCheck, ArrowLeft, Loader2, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { sendSupabaseOtp, verifySupabaseOtp, isSupabaseConfigured } from '@/lib/supabase'

interface PhoneOtpLoginProps {
  title: string
  subtitle: string
  purpose: 'consumer_login' | 'vendor_login'
  demoPhone?: string
  accent: string
  icon: React.ReactNode
  onDone: () => void
}

type Mode = 'supabase' | 'demo'

export function PhoneOtpLogin({ title, subtitle, purpose, demoPhone, accent, icon, onDone }: PhoneOtpLoginProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(demoPhone ?? '+9198765')
  const [otpId, setOtpId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>(isSupabaseConfigured ? 'supabase' : 'demo')
  const { toast } = useToast()
  const { refresh } = useAuth()

  async function sendOtp() {
    if (phone.replace(/\D/g, '').length < 10) {
      toast({ title: 'Enter a valid phone', variant: 'destructive' })
      return
    }
    setBusy(true)

    if (mode === 'supabase' && isSupabaseConfigured) {
      // Real Supabase OTP — sends actual SMS
      const result = await sendSupabaseOtp(phone)
      if (result.success) {
        setStep('otp')
        toast({ title: 'OTP sent via Supabase', description: `SMS sent to ${phone}` })
      } else {
        // Supabase failed (e.g. phone auth not enabled, rate limit) — fall back to demo
        setMode('demo')
        await sendDemoOtp()
      }
    } else {
      await sendDemoOtp()
    }
    setBusy(false)
  }

  async function sendDemoOtp() {
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, purpose }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOtpId(data.otpId)
      setStep('otp')
      toast({
        title: 'OTP sent (demo mode)',
        description: data.demo ? `Demo code: ${data.code}` : `Sent to ${phone}`,
      })
    } catch (e) {
      toast({ title: 'Failed to send OTP', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function verify() {
    if (code.length !== 6) {
      toast({ title: 'Enter the 6-digit code', variant: 'destructive' })
      return
    }
    setBusy(true)

    if (mode === 'supabase' && isSupabaseConfigured) {
      // Real Supabase verification — get access token, send to server for JWT verification
      const result = await verifySupabaseOtp(phone, code)
      if (result.success && result.accessToken) {
        // Send access token to server for session creation
        try {
          const res = await fetch('/api/auth/supabase/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: result.accessToken, purpose }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error?.message || data.error)
          await refresh()
          toast({ title: 'Welcome!', description: data.user?.name ?? 'Logged in' })
          onDone()
        } catch (e) {
          toast({ title: 'Session creation failed', description: (e as Error).message, variant: 'destructive' })
        }
      } else {
        toast({ title: 'Verification failed', description: result.error || 'Invalid code', variant: 'destructive' })
      }
    } else {
      // Demo verify
      try {
        const res = await fetch('/api/auth/otp/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ otpId, code, phone, purpose }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || data.error)
        await refresh()
        toast({ title: 'Welcome!', description: data.user?.name ?? 'Logged in' })
        onDone()
      } catch (e) {
        toast({ title: 'Verification failed', description: (e as Error).message, variant: 'destructive' })
      }
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-muted/50 to-background p-4">
      <div id="recaptcha-container" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="overflow-hidden border-border/60 shadow-xl">
          <div className={`flex items-center gap-3 bg-gradient-to-br ${accent} p-5 text-white`}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              {icon}
            </div>
            <div>
              <h1 className="text-xl font-bold">{title}</h1>
              <p className="text-sm text-white/85">{subtitle}</p>
            </div>
          </div>
          <CardContent className="p-6">
            {/* Auth mode badge */}
            <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <MessageSquare className="h-3.5 w-3.5" />
                {mode === 'supabase' ? 'Supabase Auth' : 'Demo OTP'}
              </span>
              {mode === 'supabase' ? (
                <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                  Real SMS
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">On-screen code</span>
              )}
            </div>

            {step === 'phone' ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Mobile number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 00001"
                      className="pl-9"
                      inputMode="tel"
                    />
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    {mode === 'supabase'
                      ? 'OTP delivered via Supabase Auth (real SMS)'
                      : 'Demo mode — OTP shown on screen'}
                  </p>
                </div>
                <Button onClick={sendOtp} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
                  Send OTP
                </Button>
                {demoPhone && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
                    Demo: use <span className="font-mono font-medium text-foreground">{demoPhone}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Enter 6-digit OTP</label>
                  <InputOTP maxLength={6} value={code} onChange={setCode}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                  <p className="mt-2 text-xs text-muted-foreground">Sent to {phone}</p>
                </div>
                <Button onClick={verify} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
                  Verify & Continue
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setStep('phone')} disabled={busy}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Change number
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
