import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // สำคัญมาก: Electron โหลดไฟล์แบบ file:// ต้องใช้ relative path
  server: {
    port: 5173,
    watch: { ignored: ["**/tests/output/**"] },
  },
  build: {
    outDir: "dist",
  },
});
