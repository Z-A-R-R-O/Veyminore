import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    proxy: {
      "/api/arowgo/v1/account": {
        target: "http://127.0.0.1:4174",
        changeOrigin: false,
      },
    },
  },
  test: { include: ["tests/**/*.test.{ts,js}"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("phaser") ? "phaser" : undefined),
      },
    },
  },
});
