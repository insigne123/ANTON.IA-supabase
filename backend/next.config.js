/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep this deployable subproject isolated from the root app's Webpack config.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
