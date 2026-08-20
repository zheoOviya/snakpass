// src/lib/campus-store.ts
//
// Zustand store for the user's selected campus.
//
// Selected campus is PERSISTED to localStorage so the user lands on their
// last-chosen campus on next visit. The campus is also stored on the user's
// profile server-side (User.campusId, Task 1A schema) — this store is the
// client-side cache + on-device fallback for offline / fast switching.
//
// SSR safety: the persist middleware uses `createJSONStorage(() => localStorage)`
// guarded by `typeof window !== 'undefined'`. On the server, `storage` is
// `undefined` and Zustand falls back to in-memory (no localStorage access).
//
// Governance: this store is the single client-side source of truth for the
// selected campus. Components subscribe via `useCampus((s) => s.selectedCampusId)`.

'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampusState {
  // Persisted state ---------------------------------------------------------
  selectedCampusId: string | null
  selectedCampusName: string | null

  // Transient state ---------------------------------------------------------
  isLoading: boolean
  error: string | null

  // Actions -----------------------------------------------------------------
  /** Set the active campus. Persists to localStorage immediately. */
  setCampus: (id: string, name: string) => void
  /** Clear the selected campus (sign-out / campus reset). */
  clearCampus: () => void
  /**
   * Re-validate the persisted campus by fetching it from the API. If the
   * campus no longer exists (404) or the request fails, the persisted
   * selection is left as-is (defensive — don't clear on transient errors).
   *
   * If the response includes a renamed campus, `selectedCampusName` is
   * updated to the latest value.
   */
  refresh: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCampus = create<CampusState>()(
  persist(
    (set, get) => ({
      selectedCampusId: null,
      selectedCampusName: null,
      isLoading: false,
      error: null,

      setCampus: (id, name) =>
        set({
          selectedCampusId: id,
          selectedCampusName: name,
          error: null,
        }),

      clearCampus: () =>
        set({
          selectedCampusId: null,
          selectedCampusName: null,
          error: null,
        }),

      refresh: async () => {
        const { selectedCampusId } = get()
        if (!selectedCampusId) return // nothing to validate

        set({ isLoading: true, error: null })
        try {
          const res = await fetch(`/api/campuses/${selectedCampusId}`, {
            headers: { 'Content-Type': 'application/json' },
          })
          if (!res.ok) {
            // 404 → campus was deleted; clear the stale selection.
            if (res.status === 404) {
              set({
                selectedCampusId: null,
                selectedCampusName: null,
                isLoading: false,
              })
              return
            }
            // Other errors (401, 500, network) → leave selection alone, surface error.
            const body = await res.json().catch(() => ({}))
            set({
              isLoading: false,
              error: body?.error || `Failed to fetch campus (${res.status})`,
            })
            return
          }
          const data = (await res.json()) as { campus?: { id: string; name: string } }
          if (data.campus) {
            // Sync the name (in case it was renamed server-side).
            set({
              selectedCampusId: data.campus.id,
              selectedCampusName: data.campus.name,
              isLoading: false,
              error: null,
            })
          } else {
            set({ isLoading: false, error: 'Invalid campus response shape' })
          }
        } catch (err) {
          // Network/transport error — keep the persisted selection (don't clear
          // on transient failures; the campus might still be valid offline).
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to refresh campus',
          })
        }
      },
    }),
    {
      name: 'snakzap-campus',
      // SSR guard: only use localStorage on the client.
      storage:
        typeof window !== 'undefined'
          ? createJSONStorage(() => localStorage)
          : undefined,
      // Only persist the user-facing selection — isLoading + error are
      // transient and should not survive page reloads.
      partialize: (state) => ({
        selectedCampusId: state.selectedCampusId,
        selectedCampusName: state.selectedCampusName,
      }),
    },
  ),
)
