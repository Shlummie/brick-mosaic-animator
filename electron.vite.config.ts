import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: "index.html"
      }
    }
  }
});
