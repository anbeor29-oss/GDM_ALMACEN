/**
 * ErrorBoundary — red de seguridad para que un error de RENDER no deje la pantalla
 * en BLANCO (React, sin un boundary, desmonta TODO el árbol ante un throw en render).
 * En vez de blanco, muestra el error, su detalle (plegable) y botones para recargar
 * o volver al inicio. Así el usuario SIEMPRE ve qué pasó, no una página vacía.
 *
 * OJO: sólo atrapa errores que ocurren DURANTE EL RENDER (o en lifecycle). Los
 * errores de una promesa (p. ej. un fetch/timbrado que falla) NO llegan aquí: ésos
 * se manejan con try/catch donde se llaman. Este boundary es para el caso «se borró
 * la pantalla» = un crash de render que antes dejaba blanco.
 */
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Queda en la consola para diagnóstico (DevTools → Console).
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] crash de render:', error, info?.componentStack);
    this.setState({ info });
  }

  private reset = () => this.setState({ error: null, info: null });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const detalle = `${error.name}: ${error.message}\n\n${error.stack || ''}\n\n${info?.componentStack || ''}`.trim();

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white border border-rose-200 rounded-xl shadow-xl max-w-xl w-full overflow-hidden">
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-3">
            <h1 className="text-lg font-bold text-rose-800">Algo falló en la pantalla</h1>
            <p className="text-sm text-rose-700 mt-0.5">La página no se cerró: aquí está el error para que lo veas y me lo pases.</p>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-800 font-medium break-words">{error.message || error.name || 'Error desconocido'}</p>
            <details className="rounded-lg border border-gray-200 bg-gray-50">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-600">Ver detalle técnico</summary>
              <pre className="px-3 py-2 text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-64 overflow-auto border-t border-gray-200">{detalle}</pre>
            </details>
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => { navigator.clipboard?.writeText(detalle).catch(() => {}); }}
                className="px-3 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Copiar el error</button>
              <button onClick={this.reset}
                className="px-3 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Reintentar</button>
              <button onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-white font-medium hover:bg-gray-900">Recargar la página</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
