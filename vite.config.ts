import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // reachable from your phone on the same Wi-Fi
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
      "/ws": { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
});
