/**
 * DTOs del módulo cfdi-import.
 *
 *  · PreviewResult: lo que devuelve POST /preview — el XML parseado SIN persistir.
 *  · CommitRequest: lo que envía el frontend para indicar qué quiere persistir.
 *  · CommitResult: ids de los recursos creados.
 *
 *  Diseño: explícito > implícito. Nada de booleanos sueltos en la firma.
 */

export interface PreviewedParty {
  rfc: string;
  nombre?: string;
  regimen_fiscal?: string;
  /** Código postal del domicilio fiscal (DomicilioFiscalReceptor o LugarExpedicion). */
  postal_code?: string;
  /** UsoCFDI declarado en el receptor (solo aplica si la party es receptor). */
  uso_cfdi?: string;
  /** True si en BD ya existe un customer con ese RFC bajo la misma compañía. */
  exists_in_catalog: boolean;
  existing_customer_id?: string;
  /** Si ya existe, qué tipo es ('CUSTOMER' | 'SUPPLIER'). */
  existing_party_type?: 'CUSTOMER' | 'SUPPLIER';
  /** True si el RFC coincide con el de "mi empresa" — esa parte no se debe importar. */
  is_self: boolean;
  /**
   * Validación estricta del RFC (utils/validators → validarRfcSat).
   *
   * Un RFC mal formado en una compra no es cosmético: da de alta un proveedor
   * fantasma, le programa un pago y ensucia el catálogo para siempre. Se
   * reporta en el preview para que la pantalla lo enseñe ANTES de guardar, y
   * el commit lo vuelve a exigir (el preview es informativo, no un permiso).
   */
  rfc_valido: boolean;
  rfc_tipo?: 'FISICA' | 'MORAL' | 'GENERICO_NACIONAL' | 'GENERICO_EXTRANJERO';
  rfc_motivo?: string;
  /** Días de crédito pactados, si la party ya existe. Define el vencimiento del pago. */
  credit_days?: number;
}

export interface PreviewedConcept {
  /** Índice posicional dentro del XML — sirve para que el frontend marque qué importar. */
  index: number;
  clave_sat: string;
  clave_unidad: string;
  descripcion: string;
  cantidad: number;
  valor_unitario: number;
  importe: number;
  /** True si ya existe un product con (clave_sat + descripción normalizada) similar. */
  exists_in_catalog: boolean;
  existing_product_id?: string;
}

export interface PreviewResult {
  /** Hash del archivo — el frontend lo manda de vuelta en commit para evitar TOCTOU. */
  sha256: string;
  /** UUID del CFDI si tiene Timbre Fiscal Digital — null si está sin timbrar. */
  cfdi_uuid: string | null;
  fecha_emision?: string;
  folio?: string;
  serie?: string;
  total?: number;
  emisor:   PreviewedParty;
  receptor: PreviewedParty;
  conceptos: PreviewedConcept[];
  /** Si el mismo archivo (mismo sha256) fue importado antes por esta compañía. */
  already_imported: {
    yes: boolean;
    ts?: string;
    by_user?: string;
    status?: 'PREVIEW' | 'COMMITTED' | 'SKIPPED';
  };
  /**
   * Auto-sugerencia inferida server-side comparando RFCs vs companies.rfc:
   *   · emisor.is_self  → es factura EMITIDA por mí → receptor sugerido CUSTOMER
   *   · receptor.is_self → es factura RECIBIDA → emisor sugerido SUPPLIER
   *   · ninguno → 'none' (el usuario decide)
   */
  suggestion: {
    party: 'emisor' | 'receptor' | 'none';
    kind:  'CUSTOMER' | 'SUPPLIER';
    reason: string;
  };
}

export interface CommitRequest {
  sha256: string;                    // del archivo que vio el usuario en preview
  xmlBase64: string;                 // el mismo archivo (re-enviado para garantizar consistencia)
  /** Qué hacer con la información: explícito, sin booleanos sueltos. */
  selection: {
    party: 'emisor' | 'receptor' | 'none';   // qué party persistir
    /** SUPER importante: define si la party va al catálogo como CLIENTE o PROVEEDOR. */
    partyKind: 'CUSTOMER' | 'SUPPLIER';
    concept_indexes: number[];                // qué conceptos importar como productos
  };
  /** Para los conceptos importados, qué preset de impuesto asignar (1 solo por simplicidad). */
  productTaxPresetId?: string;       // default 'iva16'
  /** Si true, devolvemos URL para abrir Nueva Factura pre-rellenada con el customer creado.
   *  Solo aplica si partyKind === 'CUSTOMER' — a un proveedor NO le facturamos. */
  prefillInvoice: boolean;
  /**
   * FASE 2 (ALMACEN §5): si la party es SUPPLIER (compra recibida), los
   * conceptos seleccionados generan ENTRADA de inventario (PURCHASE_IN).
   *  · receiveInventory: default true para SUPPLIER — false lo desactiva.
   *  · warehouseId: almacén destino; si falta, se usa el default de la empresa.
   */
  receiveInventory?: boolean;
  warehouseId?: string;
  /**
   * Almacén destino POR PARTIDA, por índice de concepto del XML.
   *
   * Una misma entrega puede repartirse: el acero a la nave y la tornillería al
   * anaquel de refacciones. Con un solo almacén por documento, repartir
   * obligaba a partir la compra en dos importaciones — y eso duplica la cuenta
   * por pagar o deja media factura sin registrar.
   *
   * Un índice que no venga cae en `warehouseId`, y si tampoco hay, en el
   * almacén por omisión de la empresa. Así el caso normal —todo al mismo
   * lugar— no obliga a capturar nada renglón por renglón.
   */
  warehouseByConcept?: Record<number, string>;
  /** Política de costos para ESTA entrada (pregunta al operador):
   *  PROMEDIO=prorratear · ULTIMO=revaluar todo · CAPAS=respetar precios.
   *  Si falta, aplica la configurada en la empresa. */
  costingMethod?: 'PROMEDIO' | 'ULTIMO' | 'CAPAS';
  /**
   * Cuánto se recibió DE VERDAD, por índice de concepto del XML.
   *
   * La factura del proveedor dice lo que despachó; el almacén cuenta lo que
   * bajó del camión. Cuando no coinciden —faltante, producto dañado, entrega
   * parcial— entra al kardex lo CONTADO, porque el inventario debe reflejar
   * el anaquel y no el papel.
   *
   * La cuenta por pagar se registra por el total facturado de todas formas:
   * al proveedor se le debe lo que facturó, y el faltante se aclara con él
   * por nota de crédito o reposición. Mezclar ambas cosas escondería el
   * problema.
   *
   * Si un índice no viene, se recibe la cantidad del XML.
   */
  receivedQuantities?: Record<number, number>;
}

export interface CommitResult {
  importId: string;
  party?:    {
    id: string;
    rfc: string;
    business_name: string;
    kind: 'CUSTOMER' | 'SUPPLIER';
    already_existed: boolean;
  };
  products:   Array<{ id: string; sku: string; name: string; already_existed: boolean }>;
  /**
   * Partidas que NO se pudieron dar de alta como producto, con el motivo.
   *
   * Antes se registraban con logger.warn y se seguía adelante: el operador
   * veía "compra registrada" y se enteraba semanas después de que faltaban
   * renglones en el kardex. Si el sistema no pudo con una partida, tiene que
   * decirlo en la misma pantalla.
   */
  products_failed: Array<{ index: number; descripcion: string; motivo: string }>;
  /** FASE 2: resultado de la entrada de inventario cuando la party es SUPPLIER. */
  inventory?: {
    /** El almacén donde cayó la mayor parte — el que se nombra en el resumen
     *  corto. Con una sola bodega es el único que hay. */
    warehouseId: string;
    warehouseCode: string;
    movements: number;
    totalUnits: number;
    /**
     * Desglose por almacén, uno por cada bodega que recibió algo.
     *
     * Va aparte del total y no lo sustituye: quien reparte una compra necesita
     * ver a dónde fue cada cosa, y quien no reparte no debería tener que leer
     * una lista de un solo renglón para saber que entraron 40 piezas.
     */
    porAlmacen: Array<{
      warehouseId: string;
      warehouseCode: string;
      movements: number;
      totalUnits: number;
    }>;
  };
  /**
   * Órdenes de compra que esta recepción cerró o dejó a medias.
   *
   * Se devuelve para que la pantalla lo diga: quien sube el XML necesita
   * enterarse de que además saldó la orden 000123, o de que quedó parcial
   * porque llegó menos de lo pedido. Sin esto, el cambio de estado ocurriría
   * en silencio y nadie sabría si el enlace funcionó.
   */
  ordenesRecibidas?: Array<{
    ordenId: string;
    folio: string;
    estadoAnterior: string;
    estadoNuevo: string;
    renglones: Array<{ productId: string; abonado: number; pedido: number; recibidoTotal: number }>;
  }>;
  /**
   * Cuenta por pagar programada en tesorería.
   *
   * Se genera SIEMPRE que la party sea proveedor y la factura tenga importe —
   * no depende de que se haya afectado el inventario ni de que las partidas
   * hayan podido darse de alta como productos. Al proveedor se le debe igual.
   */
  payment?: {
    scheduleId: string;
    amount: number;
    dueDate: string;
    /** Días de crédito del proveedor que se usaron para calcular el vencimiento. */
    creditDays?: number;
    /** True si el XML ya se había registrado: no se duplicó la deuda. */
    alreadyExisted?: boolean;
  };
  next?: {
    /** Solo cuando partyKind=CUSTOMER y prefillInvoice=true. */
    redirectTo: string;
  };
}
