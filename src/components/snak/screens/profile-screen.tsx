'use client'

// src/components/snak/screens/profile-screen.tsx
//
// Profile tab — placeholder for Wave 5+. Shows:
//  - User avatar (initials fallback)
//  - Name, phone, email, campus
//  - "Edit profile" button (placeholder toast)
//  - "Notification settings" (placeholder)
//  - "Help & Support" (placeholder)
//  - "Logout" button (calls useAuth().logout)
//
// Governance (Task 2B):
//  - Uses useAuth() for the user record (Task 2A extended it with campusId).
//  - Uses useCampus() to display the campus name even before /api/auth/me
//    has finished its initial fetch.
//  - Does NOT touch any API route or auth/session library code.

import * as React from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  User as UserIcon,
  Phone,
  Mail,
  MapPin,
  Bell,
  LifeBuoy,
  LogOut,
  Pencil,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { useCampus } from '@/lib/campus-store'

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
}
const SECTION_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.3, 0, 0, 1] },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// ProfileScreen
// ═══════════════════════════════════════════════════════════════════════════

export interface ProfileScreenProps {
  onMount?: () => void
}

export function ProfileScreen({ onMount }: ProfileScreenProps) {
  const prefersReduced = useReducedMotion()
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const selectedCampusName = useCampus((s) => s.selectedCampusName)

  React.useEffect(() => {
    onMount?.()
  }, [onMount])

  const displayName = user?.name ?? 'SnakZap User'
  const initials = displayName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleLogout() {
    await logout()
    toast({ title: 'Logged out' })
    router.push('/')
  }

  function handleEdit() {
    toast({
      title: 'Edit profile coming soon',
      description: 'Profile editing lands in Wave 5.',
    })
  }

  function handleNotifications() {
    toast({
      title: 'Notification settings coming soon',
      description: 'You’ll be able to tune notifications in Wave 5.',
    })
  }

  function handleHelp() {
    toast({
      title: 'Help & Support coming soon',
      description: 'In-app support lands in Wave 8.',
    })
  }

  return (
    <motion.div
      variants={SECTION_CONTAINER}
      initial={prefersReduced ? false : 'hidden'}
      animate="show"
      className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 pb-24"
    >
      <header className="mb-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Profile</h1>
      </header>

      {/* ── Avatar + identity card ─────────────────────────────────────────────── */}
      <motion.div variants={SECTION_ITEM}>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <Avatar className="h-16 w-16 ring-2 ring-teal-500 ring-offset-2 ring-offset-background">
              <AvatarFallback className="bg-gradient-to-br from-teal-500 to-emerald-600 text-lg font-bold text-white">
                {initials || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-foreground">{displayName}</p>
              {user?.phone && (
                <p className="truncate text-xs text-muted-foreground">{user.phone}</p>
              )}
              {selectedCampusName && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  {selectedCampusName}
                </p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleEdit}
              className="shrink-0"
            >
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Account details ──────────────────────────────────────────────────── */}
      <motion.div variants={SECTION_ITEM}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ProfileRow
              Icon={UserIcon}
              label="Name"
              value={displayName}
            />
            <ProfileRow
              Icon={Phone}
              label="Phone"
              value={user?.phone ?? '—'}
            />
            <ProfileRow
              Icon={Mail}
              label="Email"
              value={user?.email ?? 'Not set'}
            />
            <ProfileRow
              Icon={MapPin}
              label="Campus"
              value={selectedCampusName ?? 'Not selected'}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Settings shortcuts ───────────────────────────────────────────────── */}
      <motion.div variants={SECTION_ITEM}>
        <Card>
          <CardContent className="p-2">
            <SettingRow
              Icon={Bell}
              label="Notification settings"
              onClick={handleNotifications}
            />
            <SettingRow
              Icon={LifeBuoy}
              label="Help & Support"
              onClick={handleHelp}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Logout ───────────────────────────────────────────────────────────── */}
      <motion.div variants={SECTION_ITEM}>
        <Button
          type="button"
          variant="outline"
          onClick={handleLogout}
          className="w-full border-danger-200 text-danger-700 hover:bg-danger-50 dark:border-danger-900/50 dark:text-danger-300 dark:hover:bg-danger-950/30"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Logout
        </Button>
      </motion.div>

      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        SnakZap v0.2 · Wave 2 MVP
      </p>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper rows
// ═══════════════════════════════════════════════════════════════════════════

function ProfileRow({
  Icon,
  label,
  value,
}: {
  Icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/30">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

function SettingRow({
  Icon,
  label,
  onClick,
}: {
  Icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="snak-focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-muted/50"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {label}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

export default ProfileScreen
