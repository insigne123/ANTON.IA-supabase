/** @type {import('next').NextConfig} */
const nextConfig = {
  // ❗️IMPORTANTE: no mezclar objetos de Genkit en el config de Next.
  // Cualquier integración de Genkit debe ir en rutas (API) vía @genkit-ai/next.

  /* config options here */
  /* config options here */
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
    '@genkit-ai/googleai',
    '@genkit-ai/core',
    'apify-client', // evita que Webpack intente resolverlo para el cliente
  ],

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
