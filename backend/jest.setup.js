/**
 * Entorno mínimo para las pruebas unitarias.
 *
 * POR QUÉ HACE FALTA
 * Los módulos puros no tocan la base, pero sí importan `ValidationError` del
 * manejador de errores — y esa cadena arrastra el logger, que arrastra la
 * configuración, que exige las variables de entorno. Sin esto, una prueba de
 * aritmética de fechas falla por no tener un JWT_SECRET.
 *
 * Se ponen valores POSTIZOS y evidentes, no se lee el .env: una prueba no debe
 * cambiar de resultado según lo que alguien tenga configurado en su máquina, y
 * mucho menos apuntar sin querer a una base real. Nada de esto se usa: sólo
 * satisface la validación de arranque.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = 'postgresql://pruebas:pruebas@localhost:5432/no-se-usa';
process.env.JWT_SECRET = 'valor-postizo-solo-para-pruebas-unitarias-0000000000';
process.env.JWT_REFRESH_SECRET = 'valor-postizo-solo-para-pruebas-unitarias-1111111111';
