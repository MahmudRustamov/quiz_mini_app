import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const value = loadEnv(mode, ".", "VITE_").VITE_API_URL?.trim();
    let valid = false;
    try {
      const url = new URL(value || "");
      valid =
        url.protocol === "https:" &&
        !!url.hostname &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.hostname.endsWith(".localhost") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
    } catch {
      /* Fail with a configuration message, never the supplied value. */
    }
    if (!valid)
      throw new Error(
        "Set VITE_API_URL to the public HTTPS backend base URL before building. Production must not use localhost or credentials in this URL.",
      );
  }
  return {
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
  };
});
