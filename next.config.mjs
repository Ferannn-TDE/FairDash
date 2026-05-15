/** @type {import('next').NextConfig} */
const nextConfig = {
  // Unoptimized images — existing code uses plain <img> tags and public/ paths
  images: {
    unoptimized: true,
  },

  // Opt into Turbopack explicitly to silence the experimental flag conflict
  turbopack: {},

  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false }
    return config
  },
}

export default nextConfig
