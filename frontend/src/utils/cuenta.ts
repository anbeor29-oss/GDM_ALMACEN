import { useEffect, useState } from 'react';
import { api } from '@/services/api';

/**
 * Máscara de DESPLIEGUE del código de cuenta. El código guardado no cambia; esto
 * sólo decide cómo se VE. La define el usuario por empresa (ej. '##-##-##-##').
 *
 *   formatCuenta('21030026', '##-##-##-##') -> '21-03-00-26'
 *   formatCuenta('21030026', '#-##-##-###') -> '2-10-30-026'
 *
 * Cada '#' consume un dígito; lo demás (guiones, etc.) sale literal. Si sobran
 * dígitos se pegan al final. Sin máscara, o si el código NO es puro número
 * (p.ej. 'MIG-TEMPORAL'), se muestra tal cual.
 */
export function formatCuenta(
  codigo: string | number | null | undefined,
  mascara?: string
): string {
  if (codigo === null || codigo === undefined) return '';
  const s = String(codigo);
  if (!mascara) return s;
  const fmt = (d: string) => {
    let out = '';
    let di = 0;
    for (const ch of mascara) {
      if (ch === '#') { if (di < d.length) out += d[di++]; }
      else out += ch;
    }
    if (di < d.length) out += d.slice(di);
    return out;
  };
  // Subcuenta de tercero (ej. 11002074-001): formatea la base y conserva el sufijo.
  const t = /^(\d+)(-\d+)$/.exec(s);
  if (t) return fmt(t[1]) + t[2];
  if (!/^\d+$/.test(s)) return s;
  return fmt(s);
}

/**
 * Máscara de la empresa activa. Se recarga al montar la pantalla (una GET chica),
 * así nunca queda vieja al cambiar de empresa. Devuelve '' mientras carga o si no
 * hay máscara (entonces formatCuenta muestra el código tal cual).
 */
export function useMascara(): string {
  const [m, setM] = useState('');
  useEffect(() => {
    let alive = true;
    api.getMascaraCuenta().then((v) => { if (alive) setM(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return m;
}
