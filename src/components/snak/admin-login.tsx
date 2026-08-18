'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, ShieldCheck, ArrowLeft, Loader2, KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'

export function AdminLogin({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'credentials' | 'twofactor'>('credentials')
  const [email, setEmail] = useState('admin@snakzap.com')
  const [password, setPassword] = useState('admin123')
  const [otpId, setOtpId] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const { refresh } = useAuth()

  async function submitCredentials() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOtpId(data.otpId)
      setDemoCode(data.code ?? '')
      setStep('twofactor')
      toast({ title: '2FA code sent', description: data.demo ? `Demo code: ${data.code}` : data.message })
    } catch (e) {
      toast({ title: 'Login failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function verify2fa() {
    if (code.length !== 6) {
      toast({ title: 'Enter the 6-digit code', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/admin/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otpId, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await refresh()
      toast({ title: 'Admin authenticated', description: data.user?.name })
      onDone()
    } catch (e) {
      toast({ title: '2FA failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-background to-muted/50 p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="overflow-hidden border-border/60 shadow-xl">
          <div className="flex items-center gap-3 bg-gradient-to-br from-slate-800 to-slate-900 p-5 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Ops Admin Console</h1>
              <p className="text-sm text-white/75">Email + Two-Factor Authentication</p>
            </div>
          </div>
          <CardContent className="p-6">
            {step === 'credentials' ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Admin email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" inputMode="email" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="pl-9" />
                  </div>
                </div>
                <Button onClick={submitCredentials} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />}
                  Continue to 2FA
                </Button>
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
                  Demo: <span className="font-mono font-medium text-foreground">admin@snakzap.com</span> / <span className="font-mono font-medium text-foreground">admin123</span>
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Enter 2FA code</label>
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
                      Demo mode — your 2FA code: <span className="font-mono font-bold tracking-widest">{demoCode}</span>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">Delivered via email (2FA OTP channel)</p>
                </div>
                <Button onClick={verify2fa} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
                  Verify & Enter Console
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setStep('credentials')} disabled={busy}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
