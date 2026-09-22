/**
 * Convierte coordenadas pegadas de Google Maps a un punto fijo (lat/lng decimal).
 *
 * Google Maps entrega dos formatos según cómo se copien:
 *   · GMS (grados/minutos/segundos):  21°55'19.8"N 102°17'04.1"W
 *   · Decimal:                          21.922167, -102.284472
 *
 * Acepta ambos y devuelve { lat, lng } en decimal, o null si no se entiende.
 * El hemisferio manda el signo: S y W son negativos.
 */
export function parseCoordenadas(texto: string): { lat: number; lng: number } | null {
  if (!texto) return null;
  const t = texto.trim();

  // 1) GMS con hemisferio. Acepta comillas rectas o tipográficas y el símbolo de grado.
  const gms = /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]?\s*)?([NSEWnsew])/g;
  const partes: Array<{ val: number; hemi: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = gms.exec(t)) !== null) {
    const grados = Number(m[1]);
    const min = Number(m[2] || 0);
    const seg = Number(m[3] || 0);
    let val = grados + min / 60 + seg / 3600;
    const hemi = m[4].toUpperCase();
    if (hemi === 'S' || hemi === 'W') val = -val;
    partes.push({ val, hemi });
  }
  if (partes.length === 2) {
    const lat = partes.find((p) => p.hemi === 'N' || p.hemi === 'S')?.val;
    const lng = partes.find((p) => p.hemi === 'E' || p.hemi === 'W')?.val;
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    // Sin hemisferios cruzados claros: asume el orden lat, lng.
    if (Math.abs(partes[0].val) <= 90 && Math.abs(partes[1].val) <= 180) return { lat: partes[0].val, lng: partes[1].val };
  }

  // 2) Par decimal: "21.9222, -102.2845" o "21.9222 -102.2845".
  const dec = t.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (dec) {
    const lat = Number(dec[1]);
    const lng = Number(dec[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
