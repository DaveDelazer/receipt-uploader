/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    // Add support for PDF.js worker
    config.resolve.alias['pdfjs-dist'] = 'pdfjs-dist/webpack';
    // Add fallback for worker
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      http: false,
      https: false,
      url: false
    };
    return config;
  }
};

module.exports = nextConfig; 