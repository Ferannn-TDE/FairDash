/** @type {import('next').NextConfig} */
const nextConfig = {
  // Unoptimized images — existing code uses plain <img> tags and public/ paths
  images: {
    unoptimized: true,
  },

  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false }
    return config
  },
}

export default nextConfig
