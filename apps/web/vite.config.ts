import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = `http://localhost:${process.env.CUI_API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  preview: {
    proxy: {
      "/api": apiTarget,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
});
