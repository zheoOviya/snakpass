'use client'

import { useRouter } from 'next/navigation'
import { Store, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { PhoneOtpLogin } from '@/components/snak/phone-otp-login'
import { AppShell } from '@/components/snak/app-shell'
import { VendorView } from '@/components/snak/vendor-view'

export default function VendorPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
      </div>
    )
  }

  if (!user) {
    return (
      <PhoneOtpLogin
        title="Vendor Login"
        subtitle="Kitchen console with phone OTP"
        purpose="vendor_login"
        demoPhone="+919876500002"
        accent="from-orange-500 to-amber-600"
        icon={<Store className="h-6 w-6" />}
        onDone={() => router.refresh()}
      />
    )
  }

  if (!['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">This portal is for vendors. Your role: <strong>{user.role}</strong></p>
        <button onClick={() => router.push('/')} className="text-orange-600 underline">Back to home</button>
      </div>
    )
  }

  return (
    <AppShell persona="vendor">
      <VendorView />
    </AppShell>
  )
}
