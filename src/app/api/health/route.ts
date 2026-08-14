import { NextResponse } from 'next/server'

// ROLLBACK DRILL: Controlled failure for P0-27 Phase 2 staging rollback drill.
// This temporarily makes /api/health return 503 to simulate a bad deployment.
// This commit WILL BE REVERTED after the rollback drill completes.
// Normal health check logic is in the previous commit (d2646b6).

export async function GET() {
  return NextResponse.json(
    {
      status: 'down',
      error: 'ROLLBACK_DRILL_CONTROLLED_FAILURE',
      timestamp: new Date().toISOString(),
      message: 'Controlled failure for P0-27 staging rollback drill. Will be reverted.',
    },
    { status: 503 },
  )
}
