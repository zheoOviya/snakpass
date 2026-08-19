#!/bin/bash
# HB-15 item 5 — CI gate: grep-scan for unsafe external calls inside withTransaction() blocks
#
# Reference: docs/TRANSACTION_RETRY_INVARIANT.md §8.2 item 5
# Reference: docs/CODE_REVIEW_CHECKLIST.md
#
# This script scans src/app/api/**/route.ts for captureRazorpayPayment(),
# createRazorpayOrder(), or refundRazorpayPayment() calls that appear inside
# withTransaction() blocks — failing the build if found outside the publisher.
#
# The publisher (mini-services/outbox-publisher/) is exempt because its
# external calls are intentionally OUTSIDE the transaction body (Wave-4 4c
# safety property — the entire point of the outbox pattern).
#
# Usage: bash scripts/check-transaction-invariant.sh
# Exit: 0 = PASS (no violations), 1 = FAIL (violations found)

set -euo pipefail

# Helper: grep that returns empty string (not failure) when no match
safe_grep() {
  grep "$@" 2>/dev/null || true
}

echo "=== HB-15 CI Gate: Transaction Invariant Check ==="
echo "Scanning src/app/api/**/route.ts for unsafe external calls inside withTransaction() blocks..."
echo ""

VIOLATIONS_FOUND=0
FILES_SCANNED=0

# Scan each route file for the pattern:
# withTransaction(async (tx) => { ... captureRazorpayPayment( ... })
# withTransaction(async (tx) => { ... createRazorpayOrder( ... })
# withTransaction(async (tx) => { ... refundRazorpayPayment( ... })
#
# We use a simple heuristic: if a file contains both withTransaction( AND
# captureRazorpayPayment( / createRazorpayOrder( / refundRazorpayPayment(
# AND the call is NOT in the publisher (which is excluded), flag it.
#
# This is a grep-based check — it may have false positives (e.g., the call
# is in a comment, or the file has the call outside the withTransaction block).
# The ESLint rule (item 2) provides the precise AST-based enforcement; this
# CI gate is the belt-and-suspenders grep-based fallback.

for file in $(find src/app/api -name "route.ts" -type f 2>/dev/null); do
  FILES_SCANNED=$((FILES_SCANNED + 1))

  # Check if file contains withTransaction
  if ! grep -q "withTransaction" "$file" 2>/dev/null; then
    continue
  fi

  # Check for unsafe external calls that are NOT in comments
  # Allow createRazorpayOrder when called WITH an idempotency key (Option B — §8.2 item 4)
  # Flag: captureRazorpayPayment() and refundRazorpayPayment() must NEVER be inside withTransaction()
  # createRazorpayOrder() is allowed IF it has a 3rd arg (idempotencyKey) — Option B pattern
  VIOLATION_LINES=$(grep -nE "await\s+(captureRazorpayPayment|refundRazorpayPayment)\s*\(" "$file" 2>/dev/null | grep -v "^\s*//" | grep -v "//.*capture" | grep -v "//.*refund" | grep -v "//.*eslint-disable" || true)
  
  # Also check createRazorpayOrder WITHOUT idempotency key (2 args = unsafe; 3 args = Option B safe)
  UNSAFE_CREATE=$(grep -nE "await\s+createRazorpayOrder\s*\(" "$file" 2>/dev/null | grep -v "^\s*//" | grep -v "//.*create" | grep -v "//.*eslint-disable" | grep -v "idempotencyKey\|IdempotencyKey\|orderCreateIdempotencyKey" || true)
  
  ALL_VIOLATIONS="${VIOLATION_LINES}${UNSAFE_CREATE}"
  
  if [ -n "$ALL_VIOLATIONS" ]; then
    # Found a potential violation — check if it's inside a withTransaction block
    # (simple heuristic: the call is on a line after withTransaction( and before the closing })
    # This is imprecise but catches the common case
    echo "⚠️  POTENTIAL VIOLATION in $file:"
    echo "    File contains both withTransaction() AND external gateway calls."
    echo "    Lines with external calls:"
    echo "$ALL_VIOLATIONS" | head -5
    echo ""
    echo "    If these calls are OUTSIDE the withTransaction() body, this is a false positive."
    echo "    The ESLint rule (no-external-call-in-transaction) provides precise AST enforcement."
    echo "    If this is a real violation, move the call outside the transaction body."
    echo ""
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi
done

echo "=== Summary ==="
echo "Files scanned: $FILES_SCANNED"
echo "Potential violations: $VIOLATIONS_FOUND"
echo ""

if [ "$VIOLATIONS_FOUND" -gt 0 ]; then
  echo "❌ CI GATE FAILED — $VIOLATIONS_FOUND potential violation(s) found."
  echo "   Review the files above. If these are false positives (calls are outside"
  echo "   withTransaction body), verify the ESLint rule passes: bun run lint"
  echo "   If real violations, move external calls outside the transaction body."
  exit 1
fi

echo "✅ CI GATE PASSED — No unsafe external calls found inside withTransaction() blocks."
exit 0
