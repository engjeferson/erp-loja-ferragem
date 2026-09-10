export type Role = "ADMIN" | "GERENTE" | "VENDEDOR" | "FINANCEIRO";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active?: boolean;
  companyName?: string;
  isPlatformAdmin?: boolean;
}

export interface PlatformCompany {
  id: string;
  name: string;
  active: boolean;
  cnpj?: string | null;
  razaoSocial?: string | null;
  uf?: string | null;
  ambiente: NfeAmbiente;
  createdAt: string;
  hasCertificate: boolean;
  usersCount: number;
  productsCount: number;
  salesCount: number;
  purchaseOrdersCount: number;
}

export interface Category {
  id: string;
  name: string;
  description?: string | null;
}

export interface Unit {
  id: string;
  name: string;
  abbreviation: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  category?: Category | null;
  brand?: string | null;
  unitId: string;
  unit?: Unit;
  purchaseUnitId?: string | null;
  purchaseUnit?: Unit | null;
  conversionFactor: string;
  costPrice?: string;
  salePrice: string;
  averageCost?: string;
  margin?: number;
  stockQuantity: string;
  minStockQuantity: string;
  active: boolean;
  needsReview?: boolean;
}

export interface ProductPurchaseHistoryEntry {
  date: string;
  supplierName: string;
  purchaseOrderNumber: number;
  nfeChaveAcesso: string | null;
  quantity: string;
  unitCost: string;
  total: string;
}

export interface Customer {
  id: string;
  name: string;
  nomeFantasia?: string | null;
  document?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  cep?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  observacoes?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export type SaleStatus = "ORCAMENTO" | "CONFIRMADA" | "CANCELADA";
export type PaymentMethod =
  | "DINHEIRO"
  | "PIX"
  | "CARTAO_DEBITO"
  | "CARTAO_CREDITO"
  | "BOLETO"
  | "FIADO"
  | "CADERNO";

export type DiscountType = "VALOR" | "PERCENTUAL";
export type DeliveryStatus = "PENDENTE" | "ENTREGUE";

export interface DeliveryInput {
  scheduledDate?: string;
  cep?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  notes?: string;
}

export interface Delivery extends DeliveryInput {
  id: string;
  saleId: string;
  customerId?: string | null;
  status: DeliveryStatus;
  deliveredAt?: string | null;
  createdAt: string;
  sale?: { number: number; total: string };
  customer?: { name: string; phone?: string | null; whatsapp?: string | null } | null;
}

export interface SaleItem {
  id?: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
  total?: number;
}

export interface Sale {
  id: string;
  number: number;
  customerId?: string | null;
  customer?: Customer | null;
  status: SaleStatus;
  paymentMethod?: PaymentMethod | null;
  subtotal: string;
  discount: string;
  additionalDiscountType: DiscountType;
  additionalDiscountValue: string;
  freight: string;
  total: string;
  notes?: string | null;
  items: SaleItem[];
  delivery?: Delivery | null;
  createdAt: string;
}

export type PurchaseOrderStatus = "PENDENTE" | "RECEBIDA" | "CANCELADA";

export interface PurchaseOrderItem {
  id?: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitCost: number;
  total?: number;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  supplierId: string;
  supplier?: Supplier;
  status: PurchaseOrderStatus;
  subtotal: string;
  total: string;
  notes?: string | null;
  items: PurchaseOrderItem[];
  createdAt: string;
}

export type FinancialType = "PAGAR" | "RECEBER";
export type FinancialStatus = "PENDENTE" | "PARCIALMENTE_PAGO" | "PAGO" | "CANCELADO";

export interface FinancialPayment {
  id: string;
  transactionId: string;
  amount: string;
  paidAt: string;
  paymentMethod?: PaymentMethod | null;
  userId?: string | null;
  notes?: string | null;
}

export interface FinancialTransaction {
  id: string;
  type: FinancialType;
  status: FinancialStatus;
  description: string;
  amount: string;
  paidAmount: string;
  saldo: number;
  dueDate: string;
  paidAt?: string | null;
  counterpartyName?: string | null;
  supplier?: Supplier | null;
  customer?: Customer | null;
  sale?: { number: number } | null;
  installmentNumber: number;
  installmentTotal: number;
  overdue?: boolean;
  payments?: FinancialPayment[];
}

export interface CadernoSummary {
  totalComprado: number;
  totalRecebido: number;
  saldo: number;
  transactions: FinancialTransaction[];
}

export type NfeAmbiente = "PRODUCAO" | "HOMOLOGACAO";

export interface CompanySettings {
  name?: string | null;
  cnpj?: string | null;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  telefone?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  ambiente: NfeAmbiente;
  logoDataUri?: string | null;
  hasCertificate: boolean;
  certificateFileName?: string | null;
  certificateSubjectCn?: string | null;
  certificateValidTo?: string | null;
  certificateUploadedAt?: string | null;
  nfeUltNsu: string;
  lastRadarCheckAt?: string | null;
  lastRadarStatus?: string | null;
  lastRadarError?: string | null;
}

export type NfeImportStatus = "PENDENTE" | "IMPORTADA" | "REJEITADA" | "ERRO";

export interface NfeImportItem {
  id: string;
  codigoProduto: string;
  descricao: string;
  unidadeComercial: string;
  quantidadeComercial: string;
  valorUnitarioComercial: string;
  valorTotal: string;
  productId?: string | null;
  product?: { name: string } | null;
  createNewProduct: boolean;
  unitId?: string | null;
  unit?: Unit | null;
  conversionFactor: string;
  salePrice?: string | null;
  reviewed: boolean;
}

export interface NfeDuplicataPreview {
  numero: string;
  vencimento: string;
  valor: number;
}

export interface NfeImport {
  id: string;
  chaveAcesso: string;
  emitenteCnpj: string;
  emitenteNome: string;
  valorTotal: string;
  dataEmissao: string;
  status: NfeImportStatus;
  errorMessage?: string | null;
  createdAt: string;
  supplier?: Supplier | null;
  purchaseOrder?: PurchaseOrder | null;
  reviewedBy?: { name: string } | null;
  items: NfeImportItem[];
  rawData?: {
    duplicatas: NfeDuplicataPreview[];
  } | null;
}

export interface DashboardData {
  salesToday: { total: string | number; count: number };
  salesThisMonth: { total: string | number; count: number };
  lowStockProducts: { id: string; name: string; stockQuantity: number; minStockQuantity: number }[];
  pendingReceivable: string | number;
  pendingPayable: string | number;
  recentSales: Sale[];
}
