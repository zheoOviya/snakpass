'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Tag,
  Calendar,
  Clock,
  ImageOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { csrfFetch } from '@/lib/csrf-client'
import { inr, spiceLabel } from '@/lib/snack'
import { VegBadge, SpiceDots, RewardBadge, DealBadge } from './bits'

// ----------------------------------------------------------------------------
// Wave 4 Task 4B — VendorMenuManager
// ----------------------------------------------------------------------------
// Standalone CRUD UI for a vendor's menu + deals. Receives a `restaurantId`
// prop (the vendor's restaurant — resolved by the parent /api/vendor/menu
// route, but here we trust the caller). Mutations go through:
//   - GET    /api/vendor/menu?restaurantId=X         (list, grouped by category)
//   - POST   /api/vendor/menu?restaurantId=X         (create item)
//   - PATCH  /api/vendor/menu/[id]?restaurantId=X     (update item)
//   - DELETE /api/vendor/menu/[id]?restaurantId=X     (soft-delete item)
//   - GET    /api/vendor/deals?restaurantId=X         (list deals)
//   - POST   /api/vendor/deals?restaurantId=X        (create deal)
//   - PATCH  /api/vendor/deals/[id]?restaurantId=X    (update deal)
//   - DELETE /api/vendor/deals/[id]?restaurantId=X    (delete deal)
//
// All mutations use csrfFetch (auto-injects X-CSRF-Token + Idempotency-Key).
// framer-motion animates list add/remove/reorder.
// ----------------------------------------------------------------------------

export interface VendorMenuItem {
  id: string
  name: string
  description: string
  price: number // paise
  image: string
  spiceLevel: number
  isVeg: boolean
  isAvailable: boolean
  availableCount: number | null
  category: string
  rewardMultiplier: number
  createdAt: string
}

export interface VendorDeal {
  id: string
  title: string
  description: string | null
  dealType: 'percentage' | 'fixed' | 'free_item'
  dealValue: number
  validFrom: string
  validUntil: string | null
  isActive: boolean
  menuItemId: string | null
  createdAt: string
  updatedAt: string
}

interface MenuListResponse {
  restaurant: { id: string; name: string }
  categories: string[]
  items: Record<string, VendorMenuItem[]>
  total: number
}

interface DealsListResponse {
  restaurant: { id: string; name: string }
  deals: VendorDeal[]
  total: number
  activeCount: number
}

interface VendorMenuManagerProps {
  restaurantId: string
  /** Optional className to override default container styles. */
  className?: string
}

const MENU_CATEGORIES = ['Starters', 'Mains', 'Breads', 'Rice', 'Desserts', 'Beverages'] as const
const DEAL_TYPES: Array<{ value: VendorDeal['dealType']; label: string; hint: string }> = [
  { value: 'percentage', label: 'Percentage off', hint: 'e.g., 20 = 20% off' },
  { value: 'fixed', label: 'Fixed amount off', hint: 'in ₹ (whole rupees)' },
  { value: 'free_item', label: 'Free item', hint: 'select the menu item below' },
]

const SPICE_LEVELS = [
  { value: 0, label: 'Mild 🍃' },
  { value: 1, label: 'Medium 🌶' },
  { value: 2, label: 'Hot 🌶🌶' },
  { value: 3, label: 'Extra Hot 🌶🌶🌶' },
]

// paise → rupees (for form population)
const paiseToRupees = (p: number): number => Math.round(p) / 100
const rupeesToPaise = (r: number): number => Math.round(r * 100)

const formatDateTimeLocal = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  // Build yyyy-MM-ddTHH:mm in local time (input type=datetime-local format).
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isDealActive = (d: VendorDeal): boolean => {
  if (!d.isActive) return false
  const now = Date.now()
  if (d.validFrom && new Date(d.validFrom).getTime() > now) return false
  if (d.validUntil && new Date(d.validUntil).getTime() < now) return false
  return true
}

// ---------------------------------------------------------------------------
// Empty-form defaults for the menu-item sheet.
// ---------------------------------------------------------------------------
function emptyItemForm(category?: string) {
  return {
    id: undefined as string | undefined,
    name: '',
    description: '',
    price: '', // rupees (string for input control)
    image: '',
    spiceLevel: 1,
    isVeg: true,
    category: (category ?? 'Mains') as string,
    isAvailable: true,
    availableCount: '',
    rewardMultiplier: 1.0,
  }
}

function emptyDealForm() {
  return {
    id: undefined as string | undefined,
    title: '',
    description: '',
    dealType: 'percentage' as VendorDeal['dealType'],
    dealValue: '', // rupees (whole) or percentage 0..100
    validFrom: formatDateTimeLocal(new Date().toISOString()),
    validUntil: '',
    isActive: true,
    menuItemId: '' as string | undefined,
  }
}

export function VendorMenuManager({ restaurantId, className = '' }: VendorMenuManagerProps) {
  const { toast } = useToast()

  // Data state.
  const [items, setItems] = useState<VendorMenuItem[]>([])
  const [deals, setDeals] = useState<VendorDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [dealsLoading, setDealsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [busyDealId, setBusyDealId] = useState<string | null>(null)

  // Sheet / form state.
  const [itemSheetOpen, setItemSheetOpen] = useState(false)
  const [dealSheetOpen, setDealSheetOpen] = useState(false)
  const [itemForm, setItemForm] = useState(emptyItemForm())
  const [dealForm, setDealForm] = useState(emptyDealForm())

  // ---------------------------------------------------------------------------
  // Data fetchers.
  // ---------------------------------------------------------------------------
  const refreshItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/vendor/menu?restaurantId=${restaurantId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed to load menu (${res.status})`)
      }
      const data = (await res.json()) as MenuListResponse
      // Flatten the grouped items into a single list for rendering, but
      // also keep the categories ordering for the section headers.
      const flat: VendorMenuItem[] = []
      for (const cat of MENU_CATEGORIES) {
        const arr = data.items?.[cat] ?? []
        flat.push(...arr)
      }
      // Items in uncategorized / custom categories (defensive — schema enforces
      // the enum, but a future migration might add categories without UI change).
      for (const [cat, arr] of Object.entries(data.items ?? {})) {
        if (!MENU_CATEGORIES.includes(cat as (typeof MENU_CATEGORIES)[number])) {
          flat.push(...arr)
        }
      }
      setItems(flat)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load menu'
      toast({ title: 'Could not load menu', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [restaurantId, toast])

  const refreshDeals = useCallback(async () => {
    setDealsLoading(true)
    try {
      const res = await fetch(`/api/vendor/deals?restaurantId=${restaurantId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed to load deals (${res.status})`)
      }
      const data = (await res.json()) as DealsListResponse
      setDeals(data.deals ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load deals'
      toast({ title: 'Could not load deals', description: msg, variant: 'destructive' })
    } finally {
      setDealsLoading(false)
    }
  }, [restaurantId, toast])

  useEffect(() => {
    if (!restaurantId) return
    Promise.all([refreshItems(), refreshDeals()])
  }, [restaurantId, refreshItems, refreshDeals])

  // ---------------------------------------------------------------------------
  // Menu items grouped by category (preserve MENU_CATEGORIES order).
  // ---------------------------------------------------------------------------
  const grouped = useMemo(() => {
    const m: Record<string, VendorMenuItem[]> = {}
    for (const cat of MENU_CATEGORIES) m[cat] = []
    for (const it of items) {
      const arr = m[it.category] ?? (m[it.category] = [])
      arr.push(it)
    }
    return m
  }, [items])

  const activeDeals = useMemo(() => deals.filter(isDealActive), [deals])

  // ---------------------------------------------------------------------------
  // Menu item CRUD.
  // ---------------------------------------------------------------------------

  // Open the create-item sheet.
  const openCreateItem = () => {
    setItemForm(emptyItemForm())
    setItemSheetOpen(true)
  }

  // Open the edit-item sheet (prefill from existing row).
  const openEditItem = (item: VendorMenuItem) => {
    setItemForm({
      id: item.id,
      name: item.name,
      description: item.description,
      price: String(paiseToRupees(item.price)),
      image: item.image,
      spiceLevel: item.spiceLevel,
      isVeg: item.isVeg,
      category: item.category,
      isAvailable: item.isAvailable,
      availableCount: item.availableCount !== null ? String(item.availableCount) : '',
      rewardMultiplier: item.rewardMultiplier,
    })
    setItemSheetOpen(true)
  }

  // Submit create-or-edit (POST or PATCH depending on whether id is set).
  const submitItem = async () => {
    if (!itemForm.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' })
      return
    }
    const priceRupees = parseFloat(itemForm.price)
    if (isNaN(priceRupees) || priceRupees <= 0) {
      toast({ title: 'Price must be a positive number', variant: 'destructive' })
      return
    }
    if (!itemForm.image.trim()) {
      toast({ title: 'Image URL is required', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const isEdit = !!itemForm.id
      const url = isEdit
        ? `/api/vendor/menu/${itemForm.id}?restaurantId=${restaurantId}`
        : `/api/vendor/menu?restaurantId=${restaurantId}`
      const method = isEdit ? 'PATCH' : 'POST'

      const payload: Record<string, unknown> = {
        name: itemForm.name.trim(),
        description: itemForm.description.trim(),
        // Server expects rupees; converts to paise internally.
        price: priceRupees,
        image: itemForm.image.trim(),
        spiceLevel: itemForm.spiceLevel,
        isVeg: itemForm.isVeg,
        category: itemForm.category,
        isAvailable: itemForm.isAvailable,
        rewardMultiplier: itemForm.rewardMultiplier,
      }
      if (itemForm.availableCount.trim() !== '') {
        const ac = parseInt(itemForm.availableCount, 10)
        if (!isNaN(ac) && ac > 0) payload.availableCount = ac
      }
      if (isEdit) {
        // PATCH expects only the fields being updated — but sending all is
        // fine since the server preserves existing values for fields not
        // in the body OR overwrites with the provided value (which equals
        // the existing value when unchanged). The server-side schema marks
        // every field optional + `.refine` requires at least one field.
        // We omit `availableCount: undefined` so it doesn't null out the
        // existing value.
        if (itemForm.availableCount.trim() === '') {
          delete payload.availableCount
        }
      }

      const res = await csrfFetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed (${res.status})`)
      }
      const data = await res.json()
      toast({
        title: isEdit ? 'Menu item updated' : 'Menu item created',
        description: isEdit
          ? `Changes saved to "${data.item.name}"`
          : `"${data.item.name}" added to your menu`,
      })
      setItemSheetOpen(false)
      await refreshItems()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast({ title: 'Save failed', description: msg, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Toggle availability (inline switch on the row).
  const toggleAvailability = async (item: VendorMenuItem, next: boolean) => {
    setBusyItemId(item.id)
    try {
      const res = await csrfFetch(
        `/api/vendor/menu/${item.id}?restaurantId=${restaurantId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isAvailable: next }),
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed (${res.status})`)
      }
      // Optimistically update local state to reflect the toggle.
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, isAvailable: next } : it)),
      )
      toast({
        title: next ? 'Marked available' : 'Marked unavailable',
        description: `"${item.name}" is now ${next ? 'visible' : 'hidden'} to customers`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Toggle failed'
      toast({ title: 'Toggle failed', description: msg, variant: 'destructive' })
    } finally {
      setBusyItemId(null)
    }
  }

  // Soft-delete an item (uses DELETE → sets isAvailable=false + deletedAt).
  const deleteItem = async (item: VendorMenuItem) => {
    if (!confirm(`Delete "${item.name}"? This will hide it from customers (soft-delete).`)) {
      return
    }
    setBusyItemId(item.id)
    try {
      const res = await csrfFetch(
        `/api/vendor/menu/${item.id}?restaurantId=${restaurantId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed (${res.status})`)
      }
      // Optimistically remove from local state.
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      toast({
        title: 'Menu item deleted',
        description: `"${item.name}" is now hidden from customers`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' })
    } finally {
      setBusyItemId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Deal CRUD.
  // ---------------------------------------------------------------------------
  const openCreateDeal = () => {
    setDealForm(emptyDealForm())
    setDealSheetOpen(true)
  }

  const openEditDeal = (deal: VendorDeal) => {
    setDealForm({
      id: deal.id,
      title: deal.title,
      description: deal.description ?? '',
      dealType: deal.dealType,
      dealValue: String(deal.dealValue),
      validFrom: formatDateTimeLocal(deal.validFrom),
      validUntil: deal.validUntil ? formatDateTimeLocal(deal.validUntil) : '',
      isActive: deal.isActive,
      menuItemId: deal.menuItemId ?? '',
    })
    setDealSheetOpen(true)
  }

  const submitDeal = async () => {
    if (!dealForm.title.trim()) {
      toast({ title: 'Title is required', variant: 'destructive' })
      return
    }
    const dv = parseInt(dealForm.dealValue, 10)
    if (isNaN(dv) || dv < 0) {
      toast({ title: 'Value must be a non-negative number', variant: 'destructive' })
      return
    }
    if (dealForm.dealType === 'percentage' && dv > 100) {
      toast({ title: 'Percentage value must be 0..100', variant: 'destructive' })
      return
    }
    if (dealForm.dealType === 'free_item' && !dealForm.menuItemId) {
      toast({ title: 'Free-item deals require a menu item scope', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const isEdit = !!dealForm.id
      const url = isEdit
        ? `/api/vendor/deals/${dealForm.id}?restaurantId=${restaurantId}`
        : `/api/vendor/deals?restaurantId=${restaurantId}`
      const method = isEdit ? 'PATCH' : 'POST'

      const payload: Record<string, unknown> = {
        title: dealForm.title.trim(),
        description: dealForm.description.trim() || undefined,
        dealType: dealForm.dealType,
        dealValue: dv,
        validFrom: new Date(dealForm.validFrom).toISOString(),
        isActive: dealForm.isActive,
      }
      if (dealForm.validUntil) {
        payload.validUntil = new Date(dealForm.validUntil).toISOString()
      } else {
        payload.validUntil = null
      }
      if (dealForm.menuItemId) {
        payload.menuItemId = dealForm.menuItemId
      } else if (isEdit) {
        // PATCH: explicitly clear the scope if the user removed it.
        payload.menuItemId = null
      }

      const res = await csrfFetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed (${res.status})`)
      }
      const data = await res.json()
      toast({
        title: isEdit ? 'Deal updated' : 'Deal created',
        description: `"${data.deal.title}" is ${data.deal.isActive ? 'active' : 'paused'}`,
      })
      setDealSheetOpen(false)
      await refreshDeals()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast({ title: 'Save failed', description: msg, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteDeal = async (deal: VendorDeal) => {
    if (!confirm(`Delete deal "${deal.title}"? This cannot be undone.`)) return
    setBusyDealId(deal.id)
    try {
      const res = await csrfFetch(
        `/api/vendor/deals/${deal.id}?restaurantId=${restaurantId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `Failed (${res.status})`)
      }
      setDeals((prev) => prev.filter((d) => d.id !== deal.id))
      toast({ title: 'Deal deleted', description: `"${deal.title}" removed` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' })
    } finally {
      setBusyDealId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers.
  // ---------------------------------------------------------------------------
  const dealValueLabel = (d: VendorDeal): string => {
    if (d.dealType === 'percentage') return `${d.dealValue}% off`
    if (d.dealType === 'fixed') return inr(d.dealValue) + ' off'
    return 'Free item'
  }

  const scopedItemName = (d: VendorDeal): string | null => {
    if (!d.menuItemId) return null
    return items.find((it) => it.id === d.menuItemId)?.name ?? 'scoped item'
  }

  // ---------------------------------------------------------------------------
  return (
    <div className={`flex flex-col gap-6 ${className}`} data-testid="vendor-menu-manager">
      {/* ────────────────────────────────────────────────────────────
          MENU ITEMS SECTION
          ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="vmm-menu-heading">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 id="vmm-menu-heading" className="text-lg font-semibold tracking-tight">
              Menu items
            </h2>
            <Badge variant="secondary" className="font-mono">
              {items.length}
            </Badge>
          </div>
          <Button size="sm" onClick={openCreateItem} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New item
          </Button>
        </header>

        {loading ? (
          <MenuItemsSkeleton />
        ) : items.length === 0 ? (
          <EmptyMenuState onCreate={openCreateItem} />
        ) : (
          <div className="flex flex-col gap-5">
            {MENU_CATEGORIES.map((cat) => {
              const arr = grouped[cat] ?? []
              if (arr.length === 0) return null
              return (
                <div key={cat}>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {cat}
                    <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                      {arr.length} {arr.length === 1 ? 'item' : 'items'}
                    </span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {arr.map((item) => (
                        <motion.li
                          key={item.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18 }}
                        >
                          <Card
                            className={
                              'overflow-hidden transition-shadow hover:shadow-md ' +
                              (item.isAvailable ? '' : 'opacity-60')
                            }
                          >
                            <CardContent className="flex items-center gap-3 p-3">
                              {/* Image thumbnail (or placeholder) */}
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                                {item.image ? (
                                  <img
                                    src={item.image}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                      ;(e.target as HTMLImageElement).style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <ImageOff className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" />
                                )}
                              </div>

                              {/* Name + meta */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <VegBadge veg={item.isVeg} />
                                  <span className="truncate font-medium">{item.name}</span>
                                  {item.rewardMultiplier > 1 && (
                                    <RewardBadge multiplier>
                                      {item.rewardMultiplier.toFixed(1)}×
                                    </RewardBadge>
                                  )}
                                  {item.spiceLevel > 0 && (
                                    <span
                                      title={spiceLabel(item.spiceLevel).label}
                                      className="text-xs"
                                    >
                                      {spiceLabel(item.spiceLevel).emoji}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-semibold text-foreground">
                                    {inr(item.price)}
                                  </span>
                                  {item.availableCount !== null && (
                                    <span title="Inventory remaining">
                                      {item.availableCount} left
                                    </span>
                                  )}
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={
                                      item.isAvailable
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-muted-foreground'
                                    }
                                  >
                                    {item.isAvailable ? 'Available' : 'Unavailable'}
                                  </span>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex shrink-0 items-center gap-2">
                                <Switch
                                  checked={item.isAvailable}
                                  disabled={busyItemId === item.id}
                                  onCheckedChange={(next) => toggleAvailability(item, next)}
                                  aria-label={`Toggle availability for ${item.name}`}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={() => openEditItem(item)}
                                  aria-label={`Edit ${item.name}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                  disabled={busyItemId === item.id}
                                  onClick={() => deleteItem(item)}
                                  aria-label={`Delete ${item.name}`}
                                >
                                  {busyItemId === item.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ────────────────────────────────────────────────────────────
          DEALS SECTION
          ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="vmm-deals-heading" className="border-t pt-6">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 id="vmm-deals-heading" className="text-lg font-semibold tracking-tight">
              Deals
            </h2>
            <Badge variant="secondary" className="font-mono">
              {activeDeals.length} active
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={openCreateDeal} className="gap-1.5">
            <Tag className="h-4 w-4" aria-hidden="true" />
            New deal
          </Button>
        </header>

        {dealsLoading ? (
          <DealsSkeleton />
        ) : deals.length === 0 ? (
          <EmptyDealsState onCreate={openCreateDeal} />
        ) : (
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {deals.map((deal) => {
                const active = isDealActive(deal)
                const scoped = scopedItemName(deal)
                return (
                  <motion.li
                    key={deal.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                  >
                    <Card className={active ? '' : 'opacity-60'}>
                      <CardContent className="flex items-center gap-3 p-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/60">
                          <Tag className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{deal.title}</span>
                            <DealBadge label={dealValueLabel(deal)} />
                            {active ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Paused</Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" aria-hidden="true" />
                              {new Date(deal.validFrom).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                              })}
                              {deal.validUntil && (
                                <>
                                  {' → '}
                                  {new Date(deal.validUntil).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </>
                              )}
                            </span>
                            {scoped && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate" title={`Scoped to ${scoped}`}>
                                  🎯 {scoped}
                                </span>
                              </>
                            )}
                          </div>
                          {deal.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                              {deal.description}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => openEditDeal(deal)}
                            aria-label={`Edit deal ${deal.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            disabled={busyDealId === deal.id}
                            onClick={() => deleteDeal(deal)}
                            aria-label={`Delete deal ${deal.title}`}
                          >
                            {busyDealId === deal.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* ────────────────────────────────────────────────────────────
          CREATE / EDIT ITEM SHEET
          ──────────────────────────────────────────────────────── */}
      <Sheet open={itemSheetOpen} onOpenChange={setItemSheetOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-lg sm:mx-auto"
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              {itemForm.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {itemForm.id ? 'Edit menu item' : 'New menu item'}
            </SheetTitle>
            <SheetDescription>
              {itemForm.id
                ? 'Update fields below. Empty fields preserve existing values.'
                : 'Fill in the details to add this item to your menu.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 pb-2">
            <div className="flex flex-col gap-4">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-name">Name</Label>
                <Input
                  id="item-name"
                  value={itemForm.name}
                  onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Butter Chicken"
                  maxLength={200}
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-desc">Description</Label>
                <Textarea
                  id="item-desc"
                  value={itemForm.description}
                  onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g., Creamy tomato-based curry with tender chicken"
                  maxLength={2000}
                  rows={3}
                />
              </div>

              {/* Price + Available count */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-price">Price (₹)</Label>
                  <Input
                    id="item-price"
                    type="number"
                    min="0"
                    step="1"
                    value={itemForm.price}
                    onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="199"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-count">Available count (optional)</Label>
                  <Input
                    id="item-count"
                    type="number"
                    min="0"
                    step="1"
                    value={itemForm.availableCount}
                    onChange={(e) => setItemForm((f) => ({ ...f, availableCount: e.target.value }))}
                    placeholder="∞"
                  />
                </div>
              </div>

              {/* Image URL */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-image">Image URL</Label>
                <Input
                  id="item-image"
                  type="url"
                  value={itemForm.image}
                  onChange={(e) => setItemForm((f) => ({ ...f, image: e.target.value }))}
                  placeholder="https://..."
                />
                {itemForm.image && (
                  <div className="mt-1 h-20 w-full overflow-hidden rounded-md bg-muted">
                    <img
                      src={itemForm.image}
                      alt="Preview"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        const t = e.target as HTMLImageElement
                        t.style.display = 'none'
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Category + Spice level */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Category</Label>
                  <Select
                    value={itemForm.category}
                    onValueChange={(v) => setItemForm((f) => ({ ...f, category: v }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {MENU_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Spice level</Label>
                  <Select
                    value={String(itemForm.spiceLevel)}
                    onValueChange={(v) => setItemForm((f) => ({ ...f, spiceLevel: parseInt(v, 10) }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Spice" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPICE_LEVELS.map((s) => (
                        <SelectItem key={s.value} value={String(s.value)}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Veg toggle */}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="item-veg" className="cursor-pointer">
                  Vegetarian
                </Label>
                <Switch
                  id="item-veg"
                  checked={itemForm.isVeg}
                  onCheckedChange={(v) => setItemForm((f) => ({ ...f, isVeg: v }))}
                />
              </div>

              {/* Available toggle */}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="item-available" className="cursor-pointer">
                  Available to customers
                </Label>
                <Switch
                  id="item-available"
                  checked={itemForm.isAvailable}
                  onCheckedChange={(v) => setItemForm((f) => ({ ...f, isAvailable: v }))}
                />
              </div>

              {/* Reward multiplier slider */}
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="item-multiplier" className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                    Reward multiplier
                  </Label>
                  <Badge
                    variant="outline"
                    className="font-mono bg-gold-100 dark:bg-gold-950/60"
                  >
                    {itemForm.rewardMultiplier.toFixed(1)}× pts
                  </Badge>
                </div>
                <Slider
                  id="item-multiplier"
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  value={[itemForm.rewardMultiplier]}
                  onValueChange={(arr) =>
                    setItemForm((f) => ({ ...f, rewardMultiplier: arr[0] ?? 1.0 }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Higher = customers earn more reward points on this item.
                  Default is 1.0×; max 3.0×.
                </p>
              </div>
            </div>
          </div>

          <SheetFooter className="border-t p-4">
            <Button
              variant="outline"
              onClick={() => setItemSheetOpen(false)}
              disabled={saving}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={submitItem} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : itemForm.id ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {itemForm.id ? 'Save changes' : 'Create item'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ────────────────────────────────────────────────────────────
          CREATE / EDIT DEAL SHEET
          ──────────────────────────────────────────────────────── */}
      <Sheet open={dealSheetOpen} onOpenChange={setDealSheetOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-lg sm:mx-auto"
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              {dealForm.id ? 'Edit deal' : 'New deal'}
            </SheetTitle>
            <SheetDescription>
              {dealForm.id
                ? 'Update the deal fields below.'
                : 'Create a promotional deal for your customers.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 pb-2">
            <div className="flex flex-col gap-4">
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deal-title">Title</Label>
                <Input
                  id="deal-title"
                  value={dealForm.title}
                  onChange={(e) => setDealForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., 20% off on all Mains"
                  maxLength={200}
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deal-desc">Description (optional)</Label>
                <Textarea
                  id="deal-desc"
                  value={dealForm.description}
                  onChange={(e) => setDealForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g., Limited time offer — order before Friday!"
                  maxLength={2000}
                  rows={2}
                />
              </div>

              {/* Deal type + value */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Deal type</Label>
                  <Select
                    value={dealForm.dealType}
                    onValueChange={(v) =>
                      setDealForm((f) => ({ ...f, dealType: v as VendorDeal['dealType'] }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEAL_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deal-value">
                    Value{' '}
                    <span className="font-normal text-muted-foreground">
                      ({DEAL_TYPES.find((t) => t.value === dealForm.dealType)?.hint})
                    </span>
                  </Label>
                  <Input
                    id="deal-value"
                    type="number"
                    min="0"
                    step="1"
                    value={dealForm.dealValue}
                    onChange={(e) => setDealForm((f) => ({ ...f, dealValue: e.target.value }))}
                    placeholder={dealForm.dealType === 'percentage' ? '20' : '50'}
                    disabled={dealForm.dealType === 'free_item'}
                  />
                </div>
              </div>

              {/* Menu item scope (optional; required for free_item) */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deal-scope">
                  Menu item scope{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional — leave empty for restaurant-wide)
                  </span>
                </Label>
                <Select
                  value={dealForm.menuItemId ?? 'none'}
                  onValueChange={(v) =>
                    setDealForm((f) => ({ ...f, menuItemId: v === 'none' ? '' : v }))
                  }
                >
                  <SelectTrigger id="deal-scope" className="w-full">
                    <SelectValue placeholder="Restaurant-wide" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">Restaurant-wide</SelectItem>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name} ({it.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dealForm.dealType === 'free_item' && !dealForm.menuItemId && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Free-item deals require a menu item scope.
                  </p>
                )}
              </div>

              {/* Validity window */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deal-from" className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" /> Starts
                  </Label>
                  <Input
                    id="deal-from"
                    type="datetime-local"
                    value={dealForm.validFrom}
                    onChange={(e) => setDealForm((f) => ({ ...f, validFrom: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deal-until" className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" /> Ends (optional)
                  </Label>
                  <Input
                    id="deal-until"
                    type="datetime-local"
                    value={dealForm.validUntil}
                    onChange={(e) => setDealForm((f) => ({ ...f, validUntil: e.target.value }))}
                  />
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="deal-active" className="cursor-pointer">
                  Active (visible to customers)
                </Label>
                <Switch
                  id="deal-active"
                  checked={dealForm.isActive}
                  onCheckedChange={(v) => setDealForm((f) => ({ ...f, isActive: v }))}
                />
              </div>
            </div>
          </div>

          <SheetFooter className="border-t p-4">
            <Button
              variant="outline"
              onClick={() => setDealSheetOpen(false)}
              disabled={saving}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={submitDeal} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : dealForm.id ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Tag className="h-4 w-4" />
              )}
              {dealForm.id ? 'Save deal' : 'Create deal'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Skeletons + empty states
// ----------------------------------------------------------------------------

function MenuItemsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 p-3">
            <Skeleton className="h-14 w-14 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function DealsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EmptyMenuState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Plus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium">No menu items yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first dish to start accepting orders.
          </p>
        </div>
        <Button size="sm" onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create first item
        </Button>
      </CardContent>
    </Card>
  )
}

function EmptyDealsState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
          <Tag className="h-6 w-6 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium">No deals yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a promotion to attract more customers.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onCreate} className="gap-1.5">
          <Tag className="h-4 w-4" aria-hidden="true" />
          Create first deal
        </Button>
      </CardContent>
    </Card>
  )
}
