'use client'

import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Phone, ShieldCheck, ArrowLeft, Loader2, MessageSquare, Flame } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import {
  isFirebaseConfigured,
  makeRecaptcha,
  sendFirebaseOtp,
  type ConfirmationResult,
} from '@/lib/firebase'

interface PhoneOtpLoginProps {
  title: string
  subtitle: string
  purpose: 'consumer_login' | 'vendor_login'
  demoPhone?: string
  accent: string
  icon: React.ReactNode
  onDone: () => void
}

type Mode = 'firebase' | 'demo'

export function PhoneOtpLogin({ title, subtitle, purpose, demoPhone, accent, icon, onDone }: PhoneOtpLoginProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(demoPhone ?? '+9198765')
  const [otpId, setOtpId] = useState('') // demo-mode OTP record id
  const [demoCode, setDemoCode] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>(isFirebaseConfigured ? 'firebase' : 'demo')
  const [modeSwitched, setModeSwitched] = useState(false)
  const confirmationRef = useRef<ConfirmationResult | null>(null)
  const { toast } = useToast()
  const { refresh } = useAuth()

  async function sendOtp() {
    if (phone.replace(/\D/g, '').length < 10) {
      toast({ title: 'Enter a valid phone', variant: 'destructive' })
      return
    }
    setBusy(true)

    if (mode === 'firebase' && isFirebaseConfigured) {
      // Real Firebase phone OTP. signInWithPhoneNumber triggers an SMS via
      // Firebase. If the project lacks phone-auth/billing, Firebase rejects
      // here and we transparently fall back to demo mode.
      try {
        const recaptcha = makeRecaptcha('recaptcha-container')
        const confirmation = await sendFirebaseOtp(phone, recaptcha)
        confirmationRef.current = confirmation
        setStep('otp')
        toast({
          title: 'OTP sent via Firebase',
          description: `Real SMS sent to ${phone}`,
        })
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        console.warn('[firebase] phone OTP failed, falling back to demo:', msg)
        setMode('demo')
        setModeSwitched(true)
        // Fall through to demo send below.
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
      setDemoCode(data.code ?? '')
      setStep('otp')
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

    if (mode === 'firebase' && confirmationRef.current) {
      try {
        const result = await confirmationRef.current.confirm(code)
        const fbUid = result.user.uid
        // Mint our own session cookie from the verified phone.
        const res = await fetch('/api/auth/firebase/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone, purpose, firebaseUid: fbUid }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        await refresh()
        toast({ title: 'Welcome!', description: data.user?.name ?? 'Logged in' })
        onDone()
      } catch (e) {
        toast({ title: 'Verification failed', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setBusy(false)
      }
      return
    }

    // Demo verify
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otpId, code, phone, purpose }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await refresh()
      toast({ title: 'Welcome!', description: data.user?.name ?? 'Logged in' })
      onDone()
    } catch (e) {
      toast({ title: 'Verification failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-muted/50 to-background p-4">
      {/* reCAPTCHA mount point for Firebase phone auth (invisible). */}
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
                {mode === 'firebase' ? 'Firebase Authentication' : 'Demo OTP'}
              </span>
              {mode === 'firebase' ? (
                <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                  <Flame className="h-3.5 w-3.5" /> Real SMS
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">On-screen code</span>
              )}
            </div>

            {modeSwitched && step === 'phone' && (
              <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                Firebase phone OTP unavailable (check Firebase console: Phone Auth enabled + Blaze plan).
                Fell back to demo mode.
              </p>
            )}

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
                    {mode === 'firebase'
                      ? 'OTP delivered via Firebase Authentication (real SMS)'
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
                  {demoCode && (
                    <p className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      Demo mode — your code: <span className="font-mono font-bold tracking-widest">{demoCode}</span>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {mode === 'firebase' ? `SMS sent to ${phone}` : `Sent to ${phone}`}
                  </p>
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
