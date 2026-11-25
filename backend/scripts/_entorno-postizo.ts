/**
 * Entorno POSTIZO para los scripts que sólo dibujan (muestras de formatos).
 *
 * Importar un renderer arrastra pdf-helpers → config/database → environment, y
 * eso exige DB_HOST, JWT_SECRET y compañía aunque el script jamás se conecte.
 * Se ponen valores evidentes y NO se lee el .env: una muestra de un formato no
 * debe poder apuntar sin querer a una base real.
 *
 * Va importado PRIMERO (los imports corren en orden), antes que cualquier
 * módulo del backend.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postizo:postizo@localhost:5432/no-se-usa';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'no-se-usa';
process.env.DB_USER = process.env.DB_USER || 'postizo';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postizo';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'valor-postizo-solo-para-muestras-000000000000';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'valor-postizo-solo-para-muestras-111111111111';

export {};
