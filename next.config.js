/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    cpus: 1,
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: 'media.licdn.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'ui-avatars.com' },
    ],
  },

  // Válido en Next 15 para evitar bundlear dependencias pesadas en server.
  serverExternalPackages: [
    'genkit',
    '@genkit-ai/core',
    'apify-client', // evita que Webpack intente resolverlo para el cliente
    'unpdf', // lectura de PDF (pdf.js): se carga desde node_modules, sin empaquetarlo
    'mammoth', // lectura de Word
  ],

  async redirects() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon-192.png',
        permanent: true,
      },
      // Pantallas retiradas: sus direcciones viejas abren lo que las reemplazó.
      { source: '/contacted/replied', destination: '/contacted?view=reply', permanent: false },
      { source: '/contacted/analytics', destination: '/contacted', permanent: false },
      { source: '/planner', destination: '/contacted?view=scheduled', permanent: false },
      { source: '/settings/email-studio/test', destination: '/settings/email-studio', permanent: false },
      { source: '/antonia/:path+', destination: '/antonia', permanent: false },
      { source: '/admin/suggestions', destination: '/dashboard', permanent: false },
    ];
  },

  webpack(config, { isServer }) {
    // Ignorar módulos opcionales que no existen en el cliente
    const externalsToIgnore = ['@genkit-ai/firebase', '@opentelemetry/exporter-jaeger'];

    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(...externalsToIgnore);
    } else {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        '@genkit-ai/firebase': false,
        '@opentelemetry/exporter-jaeger': false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
