'use client'

import { motion } from 'framer-motion'
import { Headphones, Mail, MessageCircle, Ticket } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — Support admin module (placeholder)
// ----------------------------------------------------------------------------
// Future scope (Wave 9+):
//   - SupportTicket model (prisma/schema.prisma) — NOT yet added per
//     governance (blueprint §50 — schema changes require Orchestrator sign-off).
//   - Ticket list with status filter, assignee, escalation queue.
//   - Conversation thread + canned responses.
//
// For MVP: render a "Coming soon" placeholder card so the sidebar nav has a
// real destination + the admin can see the planned modules.
// ----------------------------------------------------------------------------

export function SupportModule() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Headphones className="h-5 w-5 text-teal-600" />
        <h3 className="text-base font-semibold">Support</h3>
        <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Ticket className="h-4 w-4 text-teal-600" /> Support tickets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-10 text-center">
              <MessageCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">
                Support tickets coming soon
              </p>
              <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
                The SupportTicket model + admin conversation surface will ship in
                a future wave. For now, customer issues raised via the in-app
                feedback form land in the Audit Trail (Overview module) until the
                dedicated queue is implemented.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-amber-600" /> Planned functionality
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
              <span><span className="font-medium text-foreground">Ticket queue</span> — paginated list with status, priority, and assignee filters.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
              <span><span className="font-medium text-foreground">Conversation thread</span> — customer + admin messages, canned responses, attachments.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
              <span><span className="font-medium text-foreground">Escalation</span> — auto-route CRITICAL tickets to the on-call admin + push notification.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
              <span><span className="font-medium text-foreground">SLA tracking</span> — first-response + resolution time, breached-SLA alerts.</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
