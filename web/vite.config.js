import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // The repo centralizes config in a single root .env (see .env.example) — load it here too,
  // so a locally-run `npm run dev` (web against a dockerized api on localhost:4000) picks up
  // VITE_API_URL the same way Docker's env_file/environment block does for the container.
  envDir: path.resolve(import.meta.dirname, ".."),
  // Never ship source maps: they would republish the original source with the bundle.
  build: { sourcemap: false },
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: process.env.PLAYWRIGHT ? false : { usePolling: true, interval: 500 },
    allowedHosts: process.env.PLAYWRIGHT
      ? undefined
      : ["prismgrc.co", "www.prismgrc.co"],
    proxy: process.env.PLAYWRIGHT ? {} : {
      "/api": {
        target: "http://api:4000",
        changeOrigin: true,
      },
    },
  },
});
