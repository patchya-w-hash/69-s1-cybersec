'use strict';

const net = require('net');
const tls = require('tls');
const mailcomposer = require('mailcomposer');

/**
 * Clean and extract raw email address conforming to RFC 5321
 */
function extractEmail(address) {
  if (!address) return '';
  if (typeof address === 'object') {
    return extractEmail(address.email || address.address || '');
  }
  const str = String(address).trim();
  const match = str.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  return str.replace(/["']/g, '').trim();
}

/**
 * Clean and extract all recipient email addresses
 */
function extractRecipients(recipients) {
  if (!recipients) return [];
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const result = [];
  for (const item of list) {
    if (typeof item === 'string' && item.includes(',')) {
      item.split(',').forEach((sub) => {
        const cleaned = extractEmail(sub);
        if (cleaned) result.push(cleaned);
      });
    } else {
      const cleaned = extractEmail(item);
      if (cleaned) result.push(cleaned);
    }
  }
  return result;
}

/**
 * Format address header for MIME if object passed
 */
function formatAddressHeader(addr) {
  if (!addr) return '';
  if (typeof addr === 'object') {
    if (addr.name && (addr.email || addr.address)) {
      return `"${addr.name.replace(/"/g, '')}" <${addr.email || addr.address}>`;
    }
    return addr.email || addr.address || '';
  }
  return String(addr).trim();
}

/**
 * Native SMTP Delivery using net/tls and mailcomposer
 */
function sendViaSmtp(providerOptions, mailOptions) {
  return new Promise((resolve, reject) => {
    const host = providerOptions.host || 'smtp.gmail.com';
    const port = parseInt(providerOptions.port, 10) || 587;
    const user = providerOptions.auth?.user || '';
    const pass = providerOptions.auth?.pass || '';
    const isDirectTls = port === 465;

    const envelopeFrom = extractEmail(user) || extractEmail(mailOptions.from);
    const recipients = [
      ...extractRecipients(mailOptions.to),
      ...extractRecipients(mailOptions.cc),
      ...extractRecipients(mailOptions.bcc),
    ];

    if (recipients.length === 0) {
      return reject(new Error('No valid recipients provided.'));
    }

    const composerOptions = {
      ...mailOptions,
      from: formatAddressHeader(mailOptions.from),
    };

    const composer = mailcomposer(composerOptions);
    composer.build((buildErr, rawMessage) => {
      if (buildErr) {
        return reject(buildErr);
      }

      let socket;
      let activeSocket;
      let step = 0;
      let buffer = '';
      let isClosed = false;
      let rcptIndex = 0;

      function cleanup(err) {
        if (!isClosed) {
          isClosed = true;
          try {
            if (activeSocket) activeSocket.end();
            if (socket && socket !== activeSocket) socket.end();
          } catch (_) {}
          if (err) reject(err);
          else resolve();
        }
      }

      function sendCommand(s, cmd) {
        s.write(cmd + '\r\n');
      }

      function handleResponse(code, line) {
        if (code >= 400) {
          return cleanup(new Error(`SMTP server response: [${code}] ${line}`));
        }

        if (step === 0 && code === 220) {
          step = 1;
          sendCommand(activeSocket, `EHLO ${host}`);
        } else if (step === 1 && code === 250) {
          if (!isDirectTls) {
            step = 2;
            sendCommand(activeSocket, 'STARTTLS');
          } else {
            step = 4;
            startAuth();
          }
        } else if (step === 2 && code === 220) {
          step = 3;
          socket.removeAllListeners('data');
          buffer = '';
          const tlsSocket = tls.connect(
            {
              socket: socket,
              host: host,
              servername: host,
            },
            () => {
              activeSocket = tlsSocket;
              attachSocketEvents(tlsSocket);
              sendCommand(tlsSocket, `EHLO ${host}`);
            }
          );
          tlsSocket.on('error', (err) => cleanup(err));
          tlsSocket.setTimeout(20000, () => cleanup(new Error('SMTP TLS connection timed out')));
        } else if (step === 3 && code === 250) {
          step = 4;
          startAuth();
        } else if (step === 4 && code === 334) {
          step = 5;
          const userB64 = Buffer.from(user).toString('base64');
          sendCommand(activeSocket, userB64);
        } else if (step === 5 && code === 334) {
          step = 6;
          const passB64 = Buffer.from(pass).toString('base64');
          sendCommand(activeSocket, passB64);
        } else if (step === 6 && code === 235) {
          step = 7;
          sendCommand(activeSocket, `MAIL FROM:<${envelopeFrom}>`);
        } else if (step === 7 && code === 250) {
          step = 8;
          rcptIndex = 0;
          sendCommand(activeSocket, `RCPT TO:<${recipients[rcptIndex]}>`);
        } else if (step === 8 && code === 250) {
          rcptIndex++;
          if (rcptIndex < recipients.length) {
            sendCommand(activeSocket, `RCPT TO:<${recipients[rcptIndex]}>`);
          } else {
            step = 9;
            sendCommand(activeSocket, 'DATA');
          }
        } else if (step === 9 && code === 354) {
          step = 10;
          activeSocket.write(rawMessage);
          activeSocket.write('\r\n.\r\n');
        } else if (step === 10 && code === 250) {
          step = 11;
          sendCommand(activeSocket, 'QUIT');
          cleanup();
        }
      }

      function startAuth() {
        if (user && pass) {
          sendCommand(activeSocket, 'AUTH LOGIN');
        } else {
          step = 7;
          sendCommand(activeSocket, `MAIL FROM:<${envelopeFrom}>`);
        }
      }

      function attachSocketEvents(s) {
        s.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\r\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line) continue;
            if (line.length >= 4 && line[3] === ' ') {
              const code = parseInt(line.substring(0, 3), 10);
              handleResponse(code, line);
            }
          }
        });
        s.on('error', (err) => cleanup(err));
        s.on('close', () => cleanup());
      }

      if (isDirectTls) {
        socket = tls.connect({ host, port, servername: host }, () => {
          activeSocket = socket;
          attachSocketEvents(socket);
        });
      } else {
        socket = net.createConnection({ host, port }, () => {
          activeSocket = socket;
          attachSocketEvents(socket);
        });
      }

      socket.setTimeout(20000, () => cleanup(new Error('SMTP connection timed out')));
      socket.on('error', (err) => cleanup(err));
    });
  });
}

/**
 * Hybrid SMTP & Mock Provider for Strapi
 * Sends live email when SMTP host and credentials are configured;
 * otherwise logs gracefully as mock.
 */
module.exports = {
  init: (providerOptions = {}, settings = {}) => {
    return {
      send: async (options) => {
        const host = providerOptions.host;
        const user = providerOptions.auth?.user;
        const pass = providerOptions.auth?.pass;
        const hasSmtpConfig = host && host !== 'localhost' && user && pass;

        const mailOptions = {
          from: options.from || settings.defaultFrom,
          to: options.to,
          cc: options.cc,
          bcc: options.bcc,
          replyTo: options.replyTo || settings.defaultReplyTo,
          subject: options.subject,
          text: options.text,
          html: options.html,
        };

        if (hasSmtpConfig) {
          try {
            strapi.log?.info?.(`[Email Service] Sending email via SMTP (${host}:${providerOptions.port || 587}) to: ${mailOptions.to}`);
            await sendViaSmtp(providerOptions, mailOptions);
            strapi.log?.info?.(`[Email Service] Real email dispatched successfully via SMTP to: ${mailOptions.to} (subject: "${mailOptions.subject}")`);
            return Promise.resolve({ ok: true });
          } catch (err) {
            strapi.log?.warn?.(`[Email Service] SMTP send failed (${err.message}); falling back gracefully.`);
            return Promise.resolve({ ok: false, error: err.message });
          }
        }

        strapi.log?.info?.(`[Email Service] Mock email dispatched to: ${mailOptions.to} (subject: "${mailOptions.subject}")`);
        return Promise.resolve({
          ok: true,
          to: mailOptions.to,
          from: mailOptions.from,
          subject: mailOptions.subject,
          text: mailOptions.text,
          html: mailOptions.html,
        });
      },
    };
  },
};
