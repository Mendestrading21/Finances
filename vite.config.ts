import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Short commit and build date, shown in the footer so an installed app can tell which version it runs.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const appVersion = (env?.GITHUB_SHA ?? "local").slice(0, 7);
const builtOn = new Date().toISOString().slice(0, 10);
export default defineConfig(({ command }) => ({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILT_ON__: JSON.stringify(builtOn),
  },
  plugins: [
    react(),
    ...(command === "build"
      ? [
          {
            name: "finance-csp",
            transformIndexHtml(html: string) {
              return html.replace(
                '<meta charset="UTF-8" />',
                `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" />`,
              );
            },
          },
        ]
      : []),
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
}));
