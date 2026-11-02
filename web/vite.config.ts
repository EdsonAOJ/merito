import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "RECONCILIATION_");

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      proxy: {
        "/accounts": {
          target: "http://api:3000",
          changeOrigin: true,
        },
        "/webhooks": {
          target: "http://api:3000",
          changeOrigin: true,
        },
        "/reconciliations": {
          target: "http://api:3000",
          changeOrigin: true,
          configure(proxy) {
            proxy.on("proxyReq", (proxyReq, req) => {
              if (
                req.method === "POST" &&
                req.url?.split("?")[0] === "/reconciliations/import-csv" &&
                env.RECONCILIATION_ADMIN_KEY
              ) {
                proxyReq.setHeader("X-Admin-Key", env.RECONCILIATION_ADMIN_KEY);
              }
            });
          },
        },
      },
    },
  };
});
