/**
 * Pruebas del parser del SAT. Son el candado que evita dos errores caros:
 * (1) traducir un error técnico a un sentido fiscal, y (2) tragarse una página
 * de login/CAPTCHA como si fuera un documento. Funciones puras, sin red ni BD.
 */
import {
  mapearSentido, pareceLoginOCaptcha, clasificarHttpError,
  interpretarJson, envolverPdf, RX_RFC,
} from './sat-parse';

describe('mapearSentido', () => {
  it('reconoce el sentido con acentos, mayúsculas o dentro de una frase', () => {
    expect(mapearSentido('Opinión POSITIVA del cumplimiento')).toBe('POSITIVA');
    expect(mapearSentido('negativa')).toBe('NEGATIVA');
    expect(mapearSentido('Sin adeudos fiscales')).toBe('SIN_ADEUDOS');
    expect(mapearSentido('Constancia VIGENTE')).toBe('VIGENTE');
    expect(mapearSentido('Suspendida')).toBe('SUSPENDIDA');
  });
  it('no inventa un sentido cuando no lo reconoce', () => {
    expect(mapearSentido('texto cualquiera')).toBeUndefined();
    expect(mapearSentido('')).toBeUndefined();
  });
});

describe('pareceLoginOCaptcha', () => {
  it('detecta login/captcha para NO evadirlos', () => {
    expect(pareceLoginOCaptcha('<div class="g-recaptcha"></div>')).toBe(true);
    expect(pareceLoginOCaptcha('Introduce el código de la imagen')).toBe(true);
    expect(pareceLoginOCaptcha('Iniciar sesión con tu e.firma')).toBe(true);
    expect(pareceLoginOCaptcha('Captura tu clave dinámica')).toBe(true);
  });
  it('no confunde un documento normal con un login', () => {
    expect(pareceLoginOCaptcha('Opinión del cumplimiento: Positiva')).toBe(false);
  });
});

describe('clasificarHttpError', () => {
  it('mapea 401/403→ERROR, 404→NO_DISPONIBLE, 429→BLOCKED, 5xx→ERROR', () => {
    expect(clasificarHttpError(403)?.estado).toBe('ERROR');
    expect(clasificarHttpError(404)?.estado).toBe('NO_DISPONIBLE');
    expect(clasificarHttpError(429)?.estado).toBe('BLOCKED');
    expect(clasificarHttpError(504)?.estado).toBe('TIMEOUT');
    expect(clasificarHttpError(503)?.estado).toBe('ERROR');
  });
  it('200 no es un error terminal', () => {
    expect(clasificarHttpError(200)).toBeNull();
  });
});

describe('interpretarJson', () => {
  it('arma un SUCCESS con sentido, fecha y PDF del origen', () => {
    const r = interpretarJson('SAT', { sentido: 'Positiva', fecha: '2026-09-01', folio: 'X1', pdfBase64: 'JVBER0' });
    expect(r.estado).toBe('SUCCESS');
    expect(r.sentido).toBe('POSITIVA');
    expect(r.fechaOpinion).toBe('2026-09-01');
    expect(r.pdfBase64).toBe('data:application/pdf;base64,JVBER0');
  });
  it('una CSF sin sentido explícito se toma como VIGENTE', () => {
    const r = interpretarJson('CSF', { pdfBase64: 'JVBER0' });
    expect(r.estado).toBe('SUCCESS');
    expect(r.sentido).toBe('VIGENTE');
  });
  it('sin sentido ni documento → NO_DISPONIBLE (no inventa)', () => {
    expect(interpretarJson('SAT', {}).estado).toBe('NO_DISPONIBLE');
  });
  it('respeta un estado NO_DISPONIBLE/SIN_OPINION explícito del origen', () => {
    expect(interpretarJson('SAT', { estado: 'SIN_OPINION' }).estado).toBe('NO_DISPONIBLE');
  });
});

describe('RX_RFC y envolverPdf', () => {
  it('valida RFC de persona moral (3 letras) y física (4 letras)', () => {
    expect(RX_RFC.test('GHC1707275Y0')).toBe(true);
    expect(RX_RFC.test('SAJ10120859A')).toBe(true);
    expect(RX_RFC.test('VECJ880326XXX')).toBe(true);
    expect(RX_RFC.test('ABC123')).toBe(false);
    expect(RX_RFC.test('12345678')).toBe(false);
  });
  it('envolverPdf agrega el prefijo sólo si falta', () => {
    expect(envolverPdf('JVBER0')).toBe('data:application/pdf;base64,JVBER0');
    expect(envolverPdf('data:application/pdf;base64,AAA')).toBe('data:application/pdf;base64,AAA');
    expect(envolverPdf('')).toBe('');
  });
});
