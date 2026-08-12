/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@wog/shared'],
};

module.exports = nextConfig;
