import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // El mismo alias que tsconfig.json: "@/lib/env" -> "<raiz>/lib/env".
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
  test: {
    // Node por defecto: casi todo es logica de servidor. Los tests que
    // necesitan DOM lo piden en su primera linea (@vitest-environment jsdom).
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./__tests__/setup.ts"],
  },
});
