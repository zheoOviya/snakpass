import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { CampusStep } from '@/components/snak/onboarding/campus-step'

// /onboarding/campus — first-run campus selection screen.
//
// Server component wrapper:
//  - If no session → bounce to /consumer (which renders the phone-OTP login).
//  - If session but the user already has a campusId → bounce to /consumer
//    (they don't need onboarding again).
//  - Otherwise, render the CampusStep client component.
//
// Governance: Wave 2 Task 2A. Additive route — no existing route touched.

export default async function CampusOnboardingPage() {
  const session = await getSessionUser()
  if (!session) {
    redirect('/consumer')
  }

  // Check the user's campusId directly (SessionUser doesn't carry it — we
  // intentionally don't extend SessionUser to preserve its governance boundary).
  const userRow = await db.user.findUnique({
    where: { id: session.userId },
    select: { campusId: true },
  })

  if (userRow?.campusId) {
    redirect('/consumer')
  }

  return <CampusStep />
}
