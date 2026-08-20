'use client'

import { createClient } from '@supabase/supabase-js'

// Client-side Supabase client for phone OTP authentication.
// Uses the publishable (anon) key — public by design.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// Lazy-init: only create the client when env vars are present.
// Without this guard, createClient(undefined, undefined) throws
// "supabaseUrl is required" at module load time, crashing any page
// that transitively imports this module (e.g. consumer/vendor portals).
// When not configured, isSupabaseConfigured=false and phone-otp-login
// falls back to the backend /api/auth/otp/send + /api/auth/otp/verify flow.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Send OTP to a phone number via Supabase
export async function sendSupabaseOtp(phone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        channel: 'sms',
      },
    })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// Verify OTP code
export async function verifySupabaseOtp(
  phone: string,
  token: string,
): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, accessToken: data.session?.access_token }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
