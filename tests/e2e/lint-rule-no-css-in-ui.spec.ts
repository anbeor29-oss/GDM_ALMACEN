/**
 * Meta-test: enforza la disciplina QA "los tests UI no acoplan a clases CSS".
 *
 *  Regla: en `06-ui-flows.spec.ts` y otros *.ui.* NO se permite:
 *    - locator('.xxx')
 *    - getAttribute('class')
 *  Excepción permitida: tests que se llamen `@regression-visual` o cualquier
 *  archivo dentro de e2e/visual/ (explícitamente declarado).
 *
 *  Se ejecuta como meta-test para que falle en CI si alguien rompe la regla.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const E2E_DIR = path.join(__dirname);
const PATTERN_CLASS_LOCATOR = /locator\(\s*['"`]\s*\./;
const PATTERN_GET_CLASS     = /getAttribute\(\s*['"`]class['"`]\s*\)/;
const PATTERN_TO_CONTAIN_CLASS = /toContain\(\s*['"`](?:bg-|from-|text-|border-)/;

const ALLOW_VISUAL_REGRESSION = /@regression-visual|UI-002/;

test.describe('@meta Lint — tests UI no acoplan a Tailwind', () => {
  test('LINT-001 No hay locator(\'.class\') en tests UI', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const f of fs.readdirSync(E2E_DIR)) {
      if (!f.endsWith('.spec.ts')) continue;
      const full = path.join(E2E_DIR, f);
      const src = fs.readFileSync(full, 'utf8');
      const lines = src.split('\n');
      lines.forEach((ln, idx) => {
        // Ignora comentarios (//, *, /*) — solo escanea código real
        const trimmed = ln.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

        if (PATTERN_CLASS_LOCATOR.test(ln) || PATTERN_GET_CLASS.test(ln) || PATTERN_TO_CONTAIN_CLASS.test(ln)) {
          const ctx = lines.slice(Math.max(0, idx - 8), idx + 1).join(' ');
          if (!ALLOW_VISUAL_REGRESSION.test(ctx)) {
            offenders.push({ file: f, line: idx + 1, text: ln.trim() });
          }
        }
      });
    }
    if (offenders.length > 0) {
      console.error('\n[LINT-001] UI tests acoplados a CSS classes:');
      for (const o of offenders) {
        console.error(`  ${o.file}:${o.line}  ${o.text}`);
      }
    }
    expect(offenders, 'usa roles ARIA / title / data-testid en vez de clases').toEqual([]);
  });
});
