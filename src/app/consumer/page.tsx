'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Utensils, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { PhoneOtpLogin } from '@/components/snak/phone-otp-login'
import { AppShell } from '@/components/snak/app-shell'
import { ConsumerView } from '@/components/snak/consumer-view'

export default function ConsumerPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // ADDITIVE (Wave 2 Task 2A): first-run campus onboarding redirect.
  // If the consumer is logged in but has no campusId yet, push them to the
  // campus onboarding screen. Placed before any render branch so the redirect
  // happens before the ConsumerView mounts. Existing render branches below
  // are preserved.
  useEffect(() => {
    if (user && user.role === 'CONSUMER' && !user.campusId) {
      router.replace('/onboarding/campus')
    }
  }, [user, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
      </div>
    )
  }

  // Not logged in -> phone OTP login
  if (!user) {
    return (
      <PhoneOtpLogin
        title="Consumer Login"
        subtitle="Order ahead with phone OTP"
        purpose="consumer_login"
        demoPhone="+919876500001"
        accent="from-teal-500 to-emerald-600"
        icon={<Utensils className="h-6 w-6" />}
        onDone={() => router.refresh()}
      />
    )
  }

  // Wrong role
  if (!['CONSUMER'].includes(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">This portal is for consumers. Your role: <strong>{user.role}</strong></p>
        <button onClick={() => router.push('/')} className="text-teal-600 underline">Back to home</button>
      </div>
    )
  }

  // While the redirect effect fires (user has no campus), show the spinner
  // instead of mounting ConsumerView. Returning null would flash a blank page.
  if (!user.campusId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-600" aria-label="Loading" />
      </div>
    )
  }

  return (
    <AppShell persona="consumer">
      <ConsumerView />
    </AppShell>
  )
}
