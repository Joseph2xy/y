import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    watch: {
      ignored: ["**/data/**", "**/.venv/**", "**/__pycache__/**"]
    },
    proxy: {
      "/health": "http://127.0.0.1:8000",
      "/setup": "http://127.0.0.1:8000",
      "/settings": "http://127.0.0.1:8000",
      "/context": "http://127.0.0.1:8000",
      "/sessions": "http://127.0.0.1:8000",
      "/saved-csv-plans": "http://127.0.0.1:8000",
      "/exports": "http://127.0.0.1:8000",
      "/sql": "http://127.0.0.1:8000"
    }
  }
});
