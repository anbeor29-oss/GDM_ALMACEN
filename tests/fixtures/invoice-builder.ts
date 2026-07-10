/**
 * InvoiceBuilder — fluent builder para tests, evita el "patrón objeto con 12 args".
 *
 *  await new InvoiceBuilder(client)
 *    .withCustomer('601')
 *    .withResico(10000)
 *    .build();
 *
 *  await new InvoiceBuilder(client)
 *    .reuseCustomer(custId)
 *    .withItem(prodId, 5.075, 100, 'iva16')
 *    .withPaymentMethod('PPD')
 *    .build();
 */
import { AuthedClient, createCustomer, createProduct, createInvoice } from './api-client';

interface LineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  taxPresetId: string;
}

interface PendingProduct {
  preset: string;
  rate: number;
  taxType: string;
  unitPrice: number;
  quantity: number;
  isExempt: boolean;
  appliesIEPS: boolean;
}

export class InvoiceBuilder {
  private c: AuthedClient;
  private customerId?: string;
  private customerRegimen = '601';
  private items: LineItem[] = [];
  private pendingProducts: PendingProduct[] = [];
  private paymentForm = '03';
  private paymentMethod: 'PUE' | 'PPD' = 'PUE';
  private cfdiUse = 'G03';
  private autoStampInvoice = false;

  constructor(c: AuthedClient) { this.c = c; }

  withCustomer(regimen = '601') { this.customerRegimen = regimen; return this; }
  reuseCustomer(id: string)     { this.customerId = id; return this; }

  withItem(productId: string, quantity: number, unitPrice: number, taxPresetId = 'iva16') {
    this.items.push({ productId, quantity, unitPrice, taxPresetId });
    return this;
  }

  /** Atajos sync (los productos se crean en build()) para encadenar libremente. */
  withResico(unitPrice = 10000, quantity = 1) {
    return this.queueProduct('resico_pf_pm', 0.16, 'IVA', unitPrice, quantity);
  }
  withHonorarios(unitPrice = 5000, quantity = 1) {
    return this.queueProduct('hon_pf_pm', 0.16, 'IVA', unitPrice, quantity);
  }
  withExento(unitPrice = 1000, quantity = 1) {
    return this.queueProduct('ivaex', 0, 'IVA', unitPrice, quantity, true, false);
  }
  withIeps(unitPrice = 100, quantity = 1) {
    return this.queueProduct('ieps_tasa', 0, 'IEPS', unitPrice, quantity, false, true);
  }
  withIva16(unitPrice = 1000, quantity = 1) {
    return this.queueProduct('iva16', 0.16, 'IVA', unitPrice, quantity);
  }

  private queueProduct(
    preset: string, rate: number, taxType: string,
    unitPrice: number, quantity: number,
    isExempt = false, appliesIEPS = false
  ): this {
    this.pendingProducts.push({ preset, rate, taxType, unitPrice, quantity, isExempt, appliesIEPS });
    return this;
  }

  withPaymentMethod(m: 'PUE' | 'PPD')  { this.paymentMethod = m; return this; }
  withPaymentForm(code: string)         { this.paymentForm = code; return this; }
  withCfdiUse(code: string)             { this.cfdiUse = code; return this; }
  stamped() { this.autoStampInvoice = true; return this; }

  async build() {
    // Resuelve los productos pendientes en orden FIFO
    for (const p of this.pendingProducts) {
      const prod = await createProduct(this.c, {
        name: `IB-${p.preset}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        taxPresetId: p.preset, taxType: p.taxType, taxRate: p.rate,
        isExempt: p.isExempt, appliesIEPS: p.appliesIEPS, basePrice: p.unitPrice,
      });
      this.items.push({
        productId: prod.id, quantity: p.quantity,
        unitPrice: p.unitPrice, taxPresetId: p.preset,
      });
    }
    if (this.items.length === 0) {
      throw new Error('InvoiceBuilder: agrega al menos un withItem*() o withResico/withIva16/...');
    }
    if (!this.customerId) {
      const stamp = Date.now();
      const cust = await createCustomer(
        this.c,
        `IB-CUST-${stamp}`,
        `XAXX${stamp % 1_000_000}E1B`,
        this.customerRegimen
      );
      this.customerId = cust.id;
    }
    const inv = await createInvoice(this.c, {
      customerId: this.customerId,
      items: this.items,
      paymentForm: this.paymentForm,
      paymentMethod: this.paymentMethod,
      cfdiUse: this.cfdiUse,
    });
    if (this.autoStampInvoice) {
      await this.c.ctx.post(`cfdi/${inv.id}/stamp`, {}).catch(() => {});
    }
    return inv;
  }
}
