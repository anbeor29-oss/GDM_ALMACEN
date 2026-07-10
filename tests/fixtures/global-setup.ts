/**
 * global-setup.ts — corre UNA vez antes de toda la suite.
 *
 * Responsabilidades:
 *  1) Pre-flight (PG + Backend + Frontend) con retry y auto-arranque.
 *  2) Verifica que el usuario seed exista (no recrearlo si ya está).
 *  3) Cachea el resultado en `process.env.__PREFLIGHT_OK__` para que las
 *     suites individuales no repitan el chequeo.
 */
import { FullConfig } from '@playwright/test';
import { runPreflight } from './pg-resilience';

export default async function globalSetup(_config: FullConfig) {
  console.log('\n──────── PRE-FLIGHT ────────');
  await runPreflight();
  process.env.__PREFLIGHT_OK__ = '1';
  console.log('────────────────────────────\n');
}
