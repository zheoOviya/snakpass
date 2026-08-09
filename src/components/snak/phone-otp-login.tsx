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

interface PhoneOtpLoginProps {
  title: string
  subtitle: string
  purpose: 'consumer_login' | 'vendor_login'
  demoPhone?: string
  accent: string // tailwind gradient classes
  icon: React.ReactNode
  onDone: () => void
}

export function PhoneOtpLogin({ title, subtitle, purpose, demoPhone, accent, icon, onDone }: PhoneOtpLoginProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(demoPhone ?? '+9198765')
  const [otpId, setOtpId] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const { refresh } = useAuth()

  async function sendOtp() {
    if (phone.replace(/\D/g, '').length < 10) {
      toast({ title: 'Enter a valid phone', variant: 'destructive' })
      return
    }
    setBusy(true)
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
      toast({ title: 'OTP sent', description: data.demo ? `Demo code: ${data.code}` : `SMS sent to ${phone}` })
    } catch (e) {
      toast({ title: 'Failed to send OTP', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (code.length !== 6) {
      toast({ title: 'Enter the 6-digit code', variant: 'destructive' })
      return
    }
    setBusy(true)
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
                    <MessageSquare className="h-3 w-3" /> OTP sent via Firebase Authentication
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
