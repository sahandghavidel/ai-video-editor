import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  experimental: {
    webpackMemoryOptimizations: true,
  },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
