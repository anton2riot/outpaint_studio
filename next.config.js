/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
if (basePath && !/^\/[a-zA-Z0-9_-]+$/.test(basePath)) {
  throw new Error('NEXT_PUBLIC_BASE_PATH must be one URL segment, for example /outpaint');
}

const nextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  ...(process.env.OUTPAINT_DIST_DIR
    ? { distDir: process.env.OUTPAINT_DIST_DIR }
    : {}),
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        // The application stores boards and generated images here. These are
        // runtime data, not source files, and must not trigger Fast Refresh.
        ignored: [
          '**/.git/**',
          '**/.next/**',
          '**/node_modules/**',
          '**/data/**',
        ],
      };
    }

    return config;
  },
};

module.exports = nextConfig;
