import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
