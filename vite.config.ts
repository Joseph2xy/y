import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8000",
      "/context": "http://127.0.0.1:8000",
      "/sessions": "http://127.0.0.1:8000",
      "/exports": "http://127.0.0.1:8000",
      "/sql": "http://127.0.0.1:8000"
    }
  }
});
