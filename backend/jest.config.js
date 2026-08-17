/**
 * Configuración de Jest.
 *
 * Sólo corre pruebas UNITARIAS —las que no necesitan base de datos—. Es una
 * decisión, no una limitación: una suite que exige un Postgres levantado deja
 * de correrse a los tres días, y entonces no protege nada. Las pruebas que sí
 * tocan la base viven en los scripts de verificación (scripts/probar-*.js), que
 * se corren a mano contra una base real cuando toca.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  /* Variables postizas: una prueba no debe depender del .env de cada máquina. */
  setupFiles: ['<rootDir>/jest.setup.js'],
  clearMocks: true,
};
