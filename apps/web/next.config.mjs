/** @type {import('next').NextConfig} */
const api = process.env.API_INTERNAL_URL || 'http://localhost:4000';
export default {
  output: 'standalone',
  // Same-origin proxy to the backend: keeps the httpOnly auth cookie first-party
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
