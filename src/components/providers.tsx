'use client'

import { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/hooks/use-auth'
import { isFirebaseConfigured, getFirebaseAnalytics } from '@/lib/firebase'

export function Providers({ children }: { children: React.ReactNode }) {
  // Initialize Firebase Analytics once on the client (matches the Firebase
  // console snippet: `const analytics = getAnalytics(app)`). Lazy + guarded
  // so SSR and unsupported browsers are skipped.
  useEffect(() => {
    if (!isFirebaseConfigured) return
    getFirebaseAnalytics().catch(() => {})
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  )
}
