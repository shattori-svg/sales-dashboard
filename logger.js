'use strict';

const pino = require('pino');

// Map pino numeric levels → Google Cloud Logging severity strings.
// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
const PINO_LEVEL_TO_GCP_SEVERITY = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

const isProd = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

const baseConfig = {
  level: process.env.LOG_LEVEL || 'info',
  // Cloud Logging picks up `severity` automatically.
  formatters: {
    level(label) {
      return { severity: PINO_LEVEL_TO_GCP_SEVERITY[label] || 'DEFAULT', level: label };
    },
  },
  // Cloud Logging expects `message` rather than pino's default `msg`.
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'sales-dashboard',
  },
  // Auto-mask sensitive fields.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.jwt',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
};

// In local dev, pretty-print if pino-pretty is available; otherwise plain JSON is fine.
const logger = isProd
  ? pino(baseConfig)
  : pino(baseConfig);

module.exports = logger;
module.exports.isProd = isProd;
