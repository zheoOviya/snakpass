/**
 * ESLint custom rule: no-external-call-in-transaction
 *
 * HB-15 item 2 — TRANSACTION_RETRY_INVARIANT §8.2 enforcement.
 *
 * Flags any `await` of an imported function whose name starts with
 * `capture` / `send` / `notify` / `publish` / `fetch` inside a
 * `withTransaction(async (tx) => { ... })` body — unless explicitly
 * allow-listed via a `// eslint-disable-next-line no-external-call-in-transaction`
 * comment.
 *
 * The outbox publisher (mini-services/outbox-publisher/) is exempt because
 * its external calls are intentionally OUTSIDE the transaction body (Wave-4 4c
 * safety property). The publisher directory is excluded via the ESLint config
 * `ignores` array.
 *
 * Reference: docs/TRANSACTION_RETRY_INVARIANT.md §8.2 item 2
 * Reference: docs/CODE_REVIEW_CHECKLIST.md
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow non-idempotent external calls (capture/send/notify/publish/fetch) inside withTransaction() bodies — TRANSACTION_RETRY_INVARIANT §8.2',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
    messages: {
      externalCall:
        '{{name}}() is called inside a withTransaction() body. External calls inside a retryable transaction are re-executed on P2034 retry, causing duplicate side effects. Move the call outside the transaction body (Option C — outbox pattern) or add a pre-generated idempotency key (Option B). If this is a false positive, add: // eslint-disable-next-line no-external-call-in-transaction',
    },
  },

  create(context) {
    let withTransactionDepth = 0
    const EXTERNAL_CALL_PREFIXES = ['capture', 'send', 'notify', 'publish', 'fetch']

    function isExternalCall(name) {
      if (!name) return false
      return EXTERNAL_CALL_PREFIXES.some((prefix) => name.startsWith(prefix))
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'withTransaction' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0]
          if (
            (arg.type === 'ArrowFunctionExpression' ||
              arg.type === 'FunctionExpression') &&
            arg.params.length > 0
          ) {
            withTransactionDepth++
          }
        }

        if (withTransactionDepth > 0 && node.parent && node.parent.type === 'AwaitExpression') {
          let calleeName = null
          if (node.callee.type === 'Identifier') {
            calleeName = node.callee.name
          } else if (node.callee.type === 'MemberExpression' && node.callee.property) {
            calleeName = node.callee.property.name
          }
          if (isExternalCall(calleeName)) {
            context.report({ node, messageId: 'externalCall', data: { name: calleeName } })
          }
        }
      },

      'CallExpression:exit'(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'withTransaction' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0]
          if (
            (arg.type === 'ArrowFunctionExpression' ||
              arg.type === 'FunctionExpression') &&
            arg.params.length > 0
          ) {
            if (withTransactionDepth > 0) withTransactionDepth--
          }
        }
      },
    }
  },
}
export default rule
