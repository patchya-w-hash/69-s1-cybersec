'use strict';

/**
 * Mock / Graceful Email Provider for Strapi
 * Ensures email operations succeed without throwing unhandled errors when SMTP is not configured.
 */
module.exports = {
  init: (providerOptions = {}, settings = {}) => {
    return {
      send: async (options) => {
        try {
          strapi.log?.info?.(`[Email Service] Mock email dispatched to: ${options?.to} (subject: "${options?.subject}")`);
          return Promise.resolve({
            ok: true,
            to: options?.to,
            from: options?.from || settings?.defaultFrom,
            subject: options?.subject,
            text: options?.text,
            html: options?.html,
          });
        } catch (err) {
          strapi.log?.warn?.(`[Email Service] Failed to send email gracefully: ${err.message}`);
          return Promise.resolve();
        }
      },
    };
  },
};
