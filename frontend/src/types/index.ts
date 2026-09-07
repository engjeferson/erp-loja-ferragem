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
  unitId: string;
  unit?: Unit;
  costPrice: string;
  salePrice: string;
  averageCost: string;
  stockQuantity: string;
  minStockQuantity: string;
  active: boolean;
  needsReview?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
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
  | "FIADO";

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
  total: string;
  notes?: string | null;
  items: SaleItem[];
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
export type FinancialStatus = "PENDENTE" | "PAGO" | "CANCELADO";

export interface FinancialTransaction {
  id: string;
  type: FinancialType;
  status: FinancialStatus;
  description: string;
  amount: string;
  dueDate: string;
  paidAt?: string | null;
  counterpartyName?: string | null;
  supplier?: Supplier | null;
  customer?: Customer | null;
  installmentNumber: number;
  installmentTotal: number;
  overdue?: boolean;
}

export type NfeAmbiente = "PRODUCAO" | "HOMOLOGACAO";

export interface CompanySettings {
  name?: string | null;
  cnpj?: string | null;
  razaoSocial?: string | null;
  uf?: string | null;
  ambiente: NfeAmbiente;
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

export interface NfeItemPreview {
  codigoProduto: string;
  descricao: string;
  unidadeComercial: string;
  quantidadeComercial: number;
  valorUnitarioComercial: number;
  valorTotal: number;
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
  rawData?: {
    itens: NfeItemPreview[];
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
