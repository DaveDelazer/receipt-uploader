/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    
    // Remove the pdfjs-dist webpack alias
    // config.resolve.alias['pdfjs-dist'] = 'pdfjs-dist/webpack';
    
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