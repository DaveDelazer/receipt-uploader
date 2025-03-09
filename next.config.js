/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  webpack: (config) => {
    // This is required for pdf.js to work
    config.resolve.alias.canvas = false;
    
    // Add fallbacks for node modules
    config.resolve.fallback = {
      canvas: false,
      fs: false,
      http: false,
      https: false,
      url: false,
      zlib: false
    };
    
    return config;
  }
};

module.exports = nextConfig; 