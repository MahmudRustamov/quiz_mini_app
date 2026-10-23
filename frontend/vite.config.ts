import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          forms: ["react-hook-form", "@hookform/resolvers/zod", "zod"],
        },
      },
    },
  },
});
