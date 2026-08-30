const path = require('path');

module.exports = ({ env }) => ({
  email: {
    config: {
      provider: env('EMAIL_PROVIDER', path.resolve(__dirname, 'providers/email-mock')),
      providerOptions: {
        host: env('SMTP_HOST', 'localhost'),
        port: env.int('SMTP_PORT', 587),
        auth: {
          user: env('SMTP_USERNAME', ''),
          pass: env('SMTP_PASSWORD', ''),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_DEFAULT_FROM', 'no-reply@strapi.io'),
        defaultReplyTo: env('EMAIL_DEFAULT_REPLY_TO', 'no-reply@strapi.io'),
      },
    },
  },
});
