module.exports = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:', 'http:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            'strapi.io',
            '*.strapi.io',
            'https:',
            'http:',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            'strapi.io',
            '*.strapi.io',
            'https:',
            'http:',
          ],
          upgradeInsecureRequests: null,
        },
      },
      frameguard: {
        action: 'sameorigin',
      },
      hsts: false,
      xssFilter: true,
      noSniff: true,
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: ['http://localhost:9092', 'http://127.0.0.1:9092', '*'],
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

