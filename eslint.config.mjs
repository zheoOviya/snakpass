import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// HB-15 item 2: Custom ESLint rule — no external calls inside withTransaction() body
// Reference: docs/TRANSACTION_RETRY_INVARIANT.md §8.2 item 2
import noExternalCallInTransaction from "./eslint-rules/no-external-call-in-transaction.js";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  plugins: {
    // HB-15 item 2: Custom plugin for TRANSACTION_RETRY_INVARIANT enforcement
    'transaction-invariant': {
      rules: {
        'no-external-call': noExternalCallInTransaction,
      },
    },
  },
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",

    // HB-15 item 2: TRANSACTION_RETRY_INVARIANT enforcement
    // Flags capture/send/notify/publish/fetch calls inside withTransaction() bodies
    "transaction-invariant/no-external-call": "error",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills",
    // Publisher is exempt — its external calls are intentionally OUTSIDE the txn body (Wave-4 4c)
    "mini-services/outbox-publisher/**",
  ],
}];

export default eslintConfig;
