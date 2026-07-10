/**
 * Winston Logger Configuration
 * Centralized logging for the application
 */

import winston from 'winston';
import { config } from '../config/environment';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}`
  )
);

const transports = [
  // Console output
  new winston.transports.Console(),

  // Error file
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: winston.format.uncolorize(),
  }),

  // All logs file
  new winston.transports.File({
    filename: 'logs/all.log',
    format: winston.format.uncolorize(),
  }),
];

const logger = winston.createLogger({
  level: config.logLevel,
  levels,
  format,
  transports,
});

export default logger;
