import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { feedProxy } from "./server/feedProxy";

export default defineConfig({
  plugins: [react(), tailwindcss(), feedProxy()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173 },
  // The local speech model runs in a module worker and loads its own WebAssembly runtime.
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
