import { defineConfig } from 'vite';

// Served at the root of a custom domain (CNAME) — relative base keeps assets
// portable whether previewed locally or deployed.
export default defineConfig({ base: './' });
