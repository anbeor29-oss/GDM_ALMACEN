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
  /** FASE 2: resultado de la entrada de inventario cuando la party es SUPPLIER. */
  inventory?: {
    warehouseId: string;
    warehouseCode: string;
    movements: number;
    totalUnits: number;
  };
  /** FASE 2: pago programado al proveedor (conclusión ALMACEN.MD). */
  payment?: {
    scheduleId: string;
    amount: number;
    dueDate: string;
  };
  next?: {
    /** Solo cuando partyKind=CUSTOMER y prefillInvoice=true. */
    redirectTo: string;
  };
}
