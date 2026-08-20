/**
 * Las reglas del motor NIF.
 *
 * ── QUÉ ES UNA REGLA AQUÍ ──
 * No es un texto de la norma: es una pregunta que se le puede hacer a un juego
 * de saldos y que tiene respuesta verificable. "¿Hay clientes sin estimación de
 * incobrables?" se contesta con dos cifras; "las cuentas por cobrar se valúan a
 * su valor de recuperación" no se contesta con nada.
 *
 * ── POR QUÉ MUCHAS DICEN "REVISAR" Y NO "ESTÁ MAL" ──
 * Una empresa puede legítimamente no tener inventario obsoleto. El motor no
 * sabe eso, y afirmar un incumplimiento que no existe entrena a la gente a
 * ignorar los avisos — que es la única forma de que un aviso real se pierda.
 *
 * Se afirma NO_CUMPLE sólo cuando la norma no admite discusión: activos
 * depreciables sin depreciación acumulada, intangibles sin amortizar.
 *
 * ── LAS VERSIONES ──
 * Cada regla lleva versión. Un hallazgo guarda con cuál se emitió, porque las
 * NIF cambian y releer un hallazgo viejo con la regla nueva lo vuelve
 * incomprensible.
 */

export type AmbitoNif = 'RECONOCIMIENTO' | 'VALUACION' | 'PRESENTACION' | 'REVELACION';
export type Severidad = 'ALTA' | 'MEDIA' | 'INFORMATIVA';
export type EstadoHallazgo = 'CUMPLE' | 'NO_CUMPLE' | 'REQUIERE_REVISION' | 'NO_APLICA';

/** Un saldo ya ubicado en el catálogo del SAT. */
export interface SaldoAgrupado {
  agrupador: string;
  cuenta: string;
  nombre: string;
  naturaleza: 'D' | 'A';
  saldo: number;
  esComplementaria?: boolean;
}

export interface ContextoNif {
  fechaCorte: string;
  saldos: SaldoAgrupado[];
  /** Suma de los saldos cuyo agrupador empieza con alguno de los prefijos. */
  suma: (...prefijos: string[]) => number;
  /** Las cuentas que caen bajo esos prefijos. */
  cuentas: (...prefijos: string[]) => SaldoAgrupado[];
  /** ¿Hay alguna cuenta mapeada a ese prefijo, con saldo o sin él? */
  existe: (...prefijos: string[]) => boolean;
}

export interface ResultadoRegla {
  estado: EstadoHallazgo;
  mensaje: string;
  cifras?: Record<string, any>;
  cuentas?: string[];
}

export interface ReglaNif {
  clave: string;
  version: number;
  norma: string;
  ambito: AmbitoNif;
  titulo: string;
  queExige: string;
  consecuencia: string;
  fundamento?: string;
  severidad: Severidad;
  evaluar: (c: ContextoNif) => ResultadoRegla;
}

const mx = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/* ═══════════════════════════════════════════════════════════════════════════
   LAS REGLAS
   ═══════════════════════════════════════════════════════════════════════════ */

export const REGLAS_NIF: ReglaNif[] = [

  /* ── C-3 · Cuentas por cobrar ── */
  {
    clave: 'C3-ESTIMACION-INCOBRABLES',
    version: 1,
    norma: 'C-3',
    ambito: 'VALUACION',
    titulo: 'Cuentas por cobrar sin estimación de incobrabilidad',
    queExige:
      'La NIF C-3 obliga a estimar la pérdida crediticia ESPERADA desde el ' +
      'reconocimiento inicial. No se espera a que la cuenta sea incobrable.',
    consecuencia:
      'El activo queda sobrevaluado y la utilidad también: la pérdida aparece ' +
      'de golpe el año que se castiga la cartera, en vez de repartirse.',
    fundamento: 'NIF C-3, párrafos de deterioro',
    severidad: 'ALTA',
    evaluar: (c): ResultadoRegla => {
      /* ── Se mide la EXPOSICION, no el neto ──
       * Sumar toda la cartera mezcla a quien debe con quien pago de mas. En la
       * balanza real el neto sale NEGATIVO —hay mas anticipos que saldos por
       * cobrar— y con el neto la regla acababa diciendo "hay -$936,332 de
       * cartera, estima su incobrabilidad", que no significa nada.
       *
       * Lo que se puede volver incobrable es lo que efectivamente deben. Los
       * saldos a favor del cliente son otra cosa, y los reporta la regla de
       * saldos contrarios a su naturaleza. */
      const porCobrar = c.cuentas('105', '106', '107')
        .filter((x) => x.saldo > 0)
        .reduce((a, x) => a + x.saldo, 0);
      if (porCobrar < 1) {
        return { estado: 'NO_APLICA', mensaje: 'No hay saldos por cobrar a clientes.' };
      }
      const cartera = porCobrar;
      const estimacion = Math.abs(c.suma('108'));
      if (estimacion > 0) {
        return {
          estado: 'CUMPLE',
          mensaje: `Hay estimación de incobrables por ${mx(estimacion)} ` +
                   `sobre una cartera de ${mx(cartera)}.`,
          cifras: { cartera, estimacion, porcentaje: +(estimacion / cartera * 100).toFixed(2) },
        };
      }
      return {
        estado: 'NO_CUMPLE',
        mensaje:
          `Hay ${mx(cartera)} de cartera y la estimación de incobrables está en cero. ` +
          `La C-3 pide estimar la pérdida esperada aunque todavía no haya una sola ` +
          `cuenta vencida.`,
        cifras: { cartera, estimacion: 0 },
        cuentas: c.cuentas('105', '106', '107').slice(0, 5).map((x) => `${x.cuenta} ${x.nombre}`),
      };
    },
  },

  /* ── C-4 · Inventarios ── */
  {
    clave: 'C4-ESTIMACION-INVENTARIO',
    version: 1,
    norma: 'C-4',
    ambito: 'VALUACION',
    titulo: 'Inventario sin estimación de obsolescencia',
    queExige:
      'La NIF C-4 valúa el inventario al MENOR entre su costo y su valor neto ' +
      'de realización. Cuando el segundo es menor, la diferencia se estima.',
    consecuencia:
      'Mercancía que ya no se vende a su precio sigue valuada a costo. El ' +
      'inventario y la utilidad quedan inflados.',
    fundamento: 'NIF C-4, valor neto de realización',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      const inv = c.suma('115');
      if (Math.abs(inv) < 1) return { estado: 'NO_APLICA', mensaje: 'No hay inventario.' };
      const est = Math.abs(c.suma('116'));
      if (est > 0) {
        return {
          estado: 'CUMPLE',
          mensaje: `Inventario de ${mx(inv)} con estimación de ${mx(est)}.`,
          cifras: { inventario: inv, estimacion: est },
        };
      }
      return {
        estado: 'REQUIERE_REVISION',
        mensaje:
          `Inventario de ${mx(inv)} sin estimación de obsolescencia. Puede estar ` +
          `bien —si todo se vende por encima de su costo—, pero es una conclusión ` +
          `que alguien tiene que firmar, no un dato.`,
        cifras: { inventario: inv, estimacion: 0 },
      };
    },
  },

  /* ── C-6 · Propiedades, planta y equipo ── */
  {
    clave: 'C6-DEPRECIACION',
    version: 1,
    norma: 'C-6',
    ambito: 'VALUACION',
    titulo: 'Activo fijo depreciable sin depreciación acumulada',
    queExige:
      'Todo componente de propiedades, planta y equipo con vida útil ' +
      'determinada se deprecia sistemáticamente a lo largo de esa vida.',
    consecuencia:
      'El activo queda a su costo original para siempre y el resultado nunca ' +
      'absorbe el desgaste. Utilidad y activo, los dos inflados.',
    fundamento: 'NIF C-6, depreciación',
    severidad: 'ALTA',
    evaluar: (c): ResultadoRegla => {
      /* 151 Terrenos NO entra: no se deprecia. */
      const depreciables = c.suma(
        '152', '153', '154', '155', '156', '157', '158', '159', '160',
        '161', '162', '163', '164', '165', '166', '167', '168', '169', '170');
      if (Math.abs(depreciables) < 1) {
        return { estado: 'NO_APLICA', mensaje: 'No hay activo fijo depreciable.' };
      }
      const dep = Math.abs(c.suma('171'));
      if (dep > 0) {
        return {
          estado: 'CUMPLE',
          mensaje: `Activo depreciable de ${mx(depreciables)} con ${mx(dep)} de ` +
                   `depreciación acumulada.`,
          cifras: { depreciables, acumulada: dep },
        };
      }
      return {
        estado: 'NO_CUMPLE',
        mensaje:
          `Hay ${mx(depreciables)} de activo fijo depreciable y cero depreciación ` +
          `acumulada. Esto no admite matices: si el bien se usa, se deprecia.`,
        cifras: { depreciables, acumulada: 0 },
        cuentas: c.cuentas('152', '153', '154', '155', '156', '157')
          .slice(0, 5).map((x) => `${x.cuenta} ${x.nombre}`),
      };
    },
  },

  {
    clave: 'C6-TERRENOS-NO-SE-DEPRECIAN',
    version: 1,
    norma: 'C-6',
    ambito: 'VALUACION',
    titulo: 'Terrenos depreciados',
    queExige:
      'El terreno tiene vida útil indefinida y NO se deprecia. Sólo se ' +
      'deprecia la construcción que está encima, por separado.',
    consecuencia:
      'Se deduce un gasto que no existe y se subvalúa un activo que no pierde ' +
      'valor por el uso. Fiscalmente también es una deducción improcedente.',
    fundamento: 'NIF C-6 · LISR Art. 34',
    severidad: 'ALTA',
    evaluar: (c): ResultadoRegla => {
      const terrenos = c.suma('151');
      if (Math.abs(terrenos) < 1) return { estado: 'NO_APLICA', mensaje: 'No hay terrenos.' };
      /* Una cuenta de depreciación cuyo nombre habla de terrenos. */
      const sospechosas = c.cuentas('171', '172')
        .filter((x) => /TERRENO/i.test(x.nombre));
      if (!sospechosas.length) {
        return {
          estado: 'CUMPLE',
          mensaje: `Hay ${mx(terrenos)} en terrenos y ninguna cuenta de depreciación ` +
                   `los toca.`,
          cifras: { terrenos },
        };
      }
      return {
        estado: 'NO_CUMPLE',
        mensaje:
          `Hay cuenta(s) de depreciación sobre terrenos. El terreno no se ` +
          `deprecia: sólo la construcción que tenga encima, y por separado.`,
        cifras: { terrenos },
        cuentas: sospechosas.map((x) => `${x.cuenta} ${x.nombre}`),
      };
    },
  },

  /* ── C-8 · Intangibles ── */
  {
    clave: 'C8-AMORTIZACION',
    version: 1,
    norma: 'C-8',
    ambito: 'VALUACION',
    titulo: 'Activos diferidos e intangibles sin amortización',
    queExige:
      'Los intangibles con vida útil definida se amortizan. Sólo los de vida ' +
      'indefinida —el crédito mercantil— no se amortizan, y a cambio se les ' +
      'prueba deterioro cada año.',
    consecuencia:
      'Gastos preoperativos y de instalación quedan como activo permanente, ' +
      'inflando el balance con algo que ya se consumió.',
    fundamento: 'NIF C-8',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      /* 180 Crédito mercantil queda fuera: no se amortiza. */
      const dif = c.suma('173', '174', '175', '176', '177', '178', '179', '181', '182');
      if (Math.abs(dif) < 1) {
        return { estado: 'NO_APLICA', mensaje: 'No hay activos diferidos ni intangibles amortizables.' };
      }
      const am = Math.abs(c.suma('183'));
      return am > 0
        ? { estado: 'CUMPLE',
            mensaje: `Diferidos de ${mx(dif)} con ${mx(am)} de amortización acumulada.`,
            cifras: { diferidos: dif, acumulada: am } }
        : { estado: 'NO_CUMPLE',
            mensaje: `Hay ${mx(dif)} de activos diferidos e intangibles sin una sola ` +
                     `amortización acumulada.`,
            cifras: { diferidos: dif, acumulada: 0 },
            cuentas: c.cuentas('173', '174', '175', '176', '177', '181')
              .slice(0, 5).map((x) => `${x.cuenta} ${x.nombre}`) };
    },
  },

  /* ── C-1 · Efectivo ── */
  {
    clave: 'C1-EFECTIVO-NEGATIVO',
    version: 1,
    norma: 'C-1',
    ambito: 'PRESENTACION',
    titulo: 'Caja o bancos con saldo negativo',
    queExige:
      'El efectivo no puede ser negativo. Un banco sobregirado es un PASIVO ' +
      '—financiamiento de la institución—, no un activo con signo menos.',
    consecuencia:
      'Presentado como activo negativo, el sobregiro se resta del efectivo ' +
      'disponible y desaparece del pasivo. Se subestiman a la vez la liquidez ' +
      'real y la deuda bancaria.',
    fundamento: 'NIF C-1 · NIF B-6 · NIF A-7 (no compensación)',
    severidad: 'ALTA',
    evaluar: (c): ResultadoRegla => {
      const negativas = c.cuentas('101', '102', '103').filter((x) => x.saldo < -0.5);
      if (!negativas.length) {
        return { estado: 'CUMPLE', mensaje: 'Ninguna cuenta de efectivo tiene saldo negativo.' };
      }
      const total = negativas.reduce((a, x) => a + x.saldo, 0);
      return {
        estado: 'NO_CUMPLE',
        mensaje:
          `${negativas.length} cuenta(s) de efectivo con saldo negativo, ` +
          `${mx(Math.abs(total))} en total. Un sobregiro es deuda con el banco y ` +
          `va en el pasivo, no como efectivo con signo menos.`,
        cifras: { cuentas: negativas.length, total },
        cuentas: negativas.map((x) => `${x.cuenta} ${x.nombre}: ${mx(x.saldo)}`),
      };
    },
  },

  /* ── A-7 · No compensación ── */
  {
    clave: 'A7-SALDO-CONTRARIO',
    version: 1,
    norma: 'A-7',
    ambito: 'PRESENTACION',
    titulo: 'Cuentas con saldo contrario a su naturaleza',
    queExige:
      'Un activo con saldo acreedor casi siempre es un pasivo mal presentado, ' +
      'y viceversa. Clientes con saldo a favor son anticipos de clientes ' +
      '(pasivo), no cartera negativa.',
    consecuencia:
      'Compensar activo contra pasivo está prohibido salvo derecho legal de ' +
      'compensación. Neteado, el balance esconde a la vez lo que se debe y lo ' +
      'que se tiene por cobrar.',
    fundamento: 'NIF A-7 · NIF B-6',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      const raras = c.saldos.filter((x) => {
        if (x.esComplementaria) return false;              // 108, 116, 171: es su naturaleza
        if (/^(101|102|103)/.test(x.agrupador)) return false; // los cubre C1-EFECTIVO-NEGATIVO
        if (Math.abs(x.saldo) < 1) return false;
        /* En la balanza cada saldo viene expresado POSITIVO en la direccion
         * propia de su cuenta: un pasivo con saldo acreedor sale positivo.
         * Asi que negativo siempre significa "al reves", sea deudora o
         * acreedora. No hace falta distinguir. */
        return x.saldo < 0;
      });
      if (!raras.length) {
        return { estado: 'CUMPLE', mensaje: 'Ninguna cuenta tiene saldo contrario a su naturaleza.' };
      }
      const total = raras.reduce((a, x) => a + Math.abs(x.saldo), 0);
      return {
        estado: 'REQUIERE_REVISION',
        mensaje:
          `${raras.length} cuenta(s) con saldo contrario a su naturaleza, ` +
          `${mx(total)} en total. Cada una es, casi siempre, una partida que va ` +
          `del otro lado del balance.`,
        cifras: { cuentas: raras.length, total },
        cuentas: raras.slice(0, 8).map((x) => `${x.cuenta} ${x.nombre}: ${mx(x.saldo)}`),
      };
    },
  },

  /* ── C-11 · Capital contable ── */
  {
    clave: 'C11-RESERVA-LEGAL',
    version: 1,
    norma: 'C-11',
    ambito: 'RECONOCIMIENTO',
    titulo: 'Reserva legal por debajo del mínimo',
    queExige:
      'La Ley General de Sociedades Mercantiles obliga a separar 5% de la ' +
      'utilidad anual hasta que la reserva legal llegue al 20% del capital social.',
    consecuencia:
      'Repartir utilidades sin haber constituido la reserva es una decisión ' +
      'impugnable, y el capital contable queda mal presentado.',
    fundamento: 'LGSM Art. 20 · NIF C-11',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      const capital = Math.abs(c.suma('301'));
      if (capital < 1) return { estado: 'NO_APLICA', mensaje: 'No hay capital social registrado.' };
      const reserva = Math.abs(c.suma('303'));
      const minimo = capital * 0.20;
      if (reserva >= minimo - 0.5) {
        return {
          estado: 'CUMPLE',
          mensaje: `Reserva legal de ${mx(reserva)}, ya alcanzó el 20% del capital social.`,
          cifras: { capital, reserva, minimo },
        };
      }
      return {
        estado: 'REQUIERE_REVISION',
        mensaje:
          `La reserva legal es ${mx(reserva)} y el mínimo del 20% sobre un capital ` +
          `de ${mx(capital)} son ${mx(minimo)}. Falta ${mx(minimo - reserva)}: hay que ` +
          `seguir separando el 5% de cada utilidad.`,
        cifras: { capital, reserva, minimo, falta: minimo - reserva },
      };
    },
  },

  /* ── D-3 · Beneficios a los empleados ── */
  {
    clave: 'D3-OBLIGACIONES-LABORALES',
    version: 1,
    norma: 'D-3',
    ambito: 'RECONOCIMIENTO',
    titulo: 'Sin pasivo por beneficios a los empleados',
    queExige:
      'Prima de antigüedad e indemnizaciones se reconocen conforme se DEVENGAN ' +
      'a lo largo de la vida laboral, no cuando el trabajador se va.',
    consecuencia:
      'Una liquidación grande cae completa sobre el resultado del año en que ' +
      'ocurre, cuando en realidad se generó durante años.',
    fundamento: 'NIF D-3 · LFT Art. 162',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      /* Sueldos en cualquiera de los cuatro grupos de gasto, más mano de obra. */
      const sueldos = c.suma('601.01', '602.01', '603.01', '604.01', '605');
      if (Math.abs(sueldos) < 1) {
        return { estado: 'NO_APLICA', mensaje: 'No hay sueldos registrados en el periodo.' };
      }
      const pasivoLaboral = Math.abs(c.suma('255')) + Math.abs(c.suma('210.11'));
      if (pasivoLaboral > 0) {
        return {
          estado: 'CUMPLE',
          mensaje: `Hay ${mx(pasivoLaboral)} de pasivo por beneficios a los empleados.`,
          cifras: { sueldos, pasivoLaboral },
        };
      }
      return {
        estado: 'REQUIERE_REVISION',
        mensaje:
          `Hay ${mx(sueldos)} de sueldos y ningún pasivo por beneficios a los ` +
          `empleados (prima de antigüedad). La D-3 pide reconocerlo conforme se ` +
          `devenga; hace falta un cálculo actuarial o, en empresas chicas, una ` +
          `estimación razonada.`,
        cifras: { sueldos, pasivoLaboral: 0 },
      };
    },
  },

  /* ── D-4 · Impuestos a la utilidad ── */
  {
    clave: 'D4-ISR-DIFERIDO',
    version: 1,
    norma: 'D-4',
    ambito: 'RECONOCIMIENTO',
    titulo: 'Sin ISR diferido reconocido',
    queExige:
      'Las diferencias temporales entre el valor contable y el fiscal de ' +
      'activos y pasivos generan un impuesto diferido que hay que reconocer.',
    consecuencia:
      'El resultado no refleja el impuesto que corresponde al periodo, sólo ' +
      'el que se paga. Es la diferencia entre los dos libros de depreciación, ' +
      'entre otras.',
    fundamento: 'NIF D-4',
    severidad: 'INFORMATIVA',
    evaluar: (c): ResultadoRegla => {
      const isr = Math.abs(c.suma('611'));
      if (isr < 1) return { estado: 'NO_APLICA', mensaje: 'No hay ISR del ejercicio registrado.' };
      const diferido = Math.abs(c.suma('185')) + Math.abs(c.suma('259'));
      return diferido > 0
        ? { estado: 'CUMPLE',
            mensaje: `Hay ${mx(diferido)} de impuestos diferidos reconocidos.`,
            cifras: { isr, diferido } }
        : { estado: 'REQUIERE_REVISION',
            mensaje:
              `Hay ${mx(isr)} de ISR y ningún impuesto diferido. Si el libro ` +
              `contable y el fiscal difieren —y difieren en cuanto hay ` +
              `depreciación—, falta reconocer el diferido.`,
            cifras: { isr, diferido: 0 } };
    },
  },

  /* ── A-5 · La ecuación ── */
  {
    clave: 'A5-ECUACION-CONTABLE',
    version: 1,
    norma: 'A-5',
    ambito: 'PRESENTACION',
    titulo: 'La ecuación contable no cierra',
    queExige:
      'Activo = Pasivo + Capital contable. Es la dualidad económica: todo ' +
      'recurso tiene una fuente.',
    consecuencia:
      'Si no cierra, ningún estado financiero que salga de esos saldos es ' +
      'confiable — y ninguna de las demás revisiones significa nada.',
    fundamento: 'NIF A-2 (dualidad económica) · NIF A-5',
    severidad: 'ALTA',
    evaluar: (c): ResultadoRegla => {
      const activo = c.suma('1');
      const pasivo = c.suma('2');
      const capital = c.suma('3');

      /* ── El resultado se arma por NATURALEZA, no por el digito ──
       * El 703 del Anexo 24 guarda las dos cosas: gastos financieros en
       * 703.01-11 y PRODUCTOS financieros en 703.12-21. Tratar todo el 703
       * como gasto resta un ingreso en vez de sumarlo, y el error entra dos
       * veces —una por no sumarlo y otra por restarlo—.
       *
       * Con la naturaleza no hay ambiguedad: acreedora es ingreso, deudora es
       * gasto, y da igual en que rubro haya caido. */
      const resultados = c.cuentas('4', '5', '6', '7');
      const ingresos = resultados.filter((x) => x.naturaleza === 'A')
        .reduce((a, x) => a + x.saldo, 0);
      const egresos = resultados.filter((x) => x.naturaleza === 'D')
        .reduce((a, x) => a + x.saldo, 0);
      const costos = c.cuentas('5').filter((x) => x.naturaleza === 'D')
        .reduce((a, x) => a + x.saldo, 0);
      const resultado = ingresos - egresos;
      const gastos = egresos - costos;
      const dif = activo - (pasivo + capital + resultado);

      if (Math.abs(dif) <= 1) {
        return {
          estado: 'CUMPLE',
          mensaje: `La ecuación cierra: activo ${mx(activo)} contra pasivo más ` +
                   `capital más resultado.`,
          cifras: { activo, pasivo, capital, resultado, diferencia: dif },
        };
      }
      return {
        estado: Math.abs(dif) > 100 ? 'NO_CUMPLE' : 'REQUIERE_REVISION',
        mensaje:
          `La ecuación no cierra por ${mx(Math.abs(dif))}. Activo ${mx(activo)} ` +
          `contra ${mx(pasivo + capital + resultado)} de pasivo, capital y resultado.` +
          (Math.abs(dif) <= 100
            ? ' Es poco, probablemente redondeo — pero se arrastra a todo lo demás.'
            : ''),
        cifras: { activo, pasivo, capital, resultado, diferencia: dif },
      };
    },
  },

  /* ── B-6 · Presentación ── */
  {
    clave: 'B6-CUENTAS-SIN-CLASIFICAR',
    version: 1,
    norma: 'B-6',
    ambito: 'PRESENTACION',
    titulo: 'Cuentas con saldo que no llegaron al catálogo del SAT',
    queExige:
      'Toda partida con saldo tiene que poder ubicarse en un rubro del estado ' +
      'de situación financiera para poder presentarse.',
    consecuencia:
      'Una cuenta con saldo que no cae en ningún rubro se queda fuera del ' +
      'estado financiero, y entonces éste ya no cuadra.',
    fundamento: 'NIF B-6',
    severidad: 'MEDIA',
    evaluar: (c): ResultadoRegla => {
      const huerfanas = c.saldos.filter((x) => !x.agrupador && Math.abs(x.saldo) >= 1);
      return huerfanas.length === 0
        ? { estado: 'CUMPLE', mensaje: 'Todas las cuentas con saldo están ubicadas en un rubro.' }
        : { estado: 'NO_CUMPLE',
            mensaje: `${huerfanas.length} cuenta(s) con saldo no se pudieron ubicar en ` +
                     `ningún rubro del catálogo.`,
            cifras: { cuentas: huerfanas.length,
                      total: huerfanas.reduce((a, x) => a + Math.abs(x.saldo), 0) },
            cuentas: huerfanas.slice(0, 8).map((x) => `${x.cuenta} ${x.nombre}`) };
    },
  },

  /* ── C-9 · Provisiones ── */
  {
    clave: 'C9-PROVISIONES',
    version: 1,
    norma: 'C-9',
    ambito: 'REVELACION',
    titulo: 'Provisiones, contingencias y compromisos por revelar',
    queExige:
      'Se reconoce una provisión cuando hay una obligación presente probable ' +
      'y estimable. Lo que sólo es posible se REVELA en notas, no se registra.',
    consecuencia:
      'Un juicio laboral en curso o una garantía otorgada que no se revelan ' +
      'dejan al lector sin ver un riesgo que sí existe.',
    fundamento: 'NIF C-9',
    severidad: 'INFORMATIVA',
    evaluar: () => ({
      estado: 'REQUIERE_REVISION',
      mensaje:
        'Las contingencias no se deducen de los saldos: hay que preguntarlas. ' +
        'Juicios en curso, garantías otorgadas, avales, compromisos de compra. ' +
        'Si no hay ninguna, se deja constancia de que se revisó.',
    }),
  },
];

/** Las reglas indexadas, para resolver clave+versión rápido. */
export const REGLA_POR_CLAVE = new Map(REGLAS_NIF.map((r) => [r.clave, r]));
