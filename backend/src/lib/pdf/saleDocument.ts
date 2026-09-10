import PDFDocument from "pdfkit";
import { Response } from "express";
import { APP_BRAND_NAME } from "../../config/brand";

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("pt-BR");
}

export interface SaleDocumentCompany {
  name: string;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  cnpj?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  logoData?: Buffer | null;
}

export interface SaleDocumentItem {
  productName: string;
  quantity: string;
  unitAbbreviation: string;
  unitPrice: string;
  total: string;
}

export interface SaleDocumentDelivery {
  scheduledDate?: Date | null;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  notes?: string | null;
}

export interface SaleDocumentData {
  number: number;
  isBudget: boolean;
  createdAt: Date;
  customerName?: string | null;
  customerDocument?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  items: SaleDocumentItem[];
  subtotal: string;
  discount: string;
  freight: string;
  total: string;
  notes?: string | null;
  delivery?: SaleDocumentDelivery | null;
  paymentMethodLabel?: string | null;
  installmentTotal?: number | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO_DEBITO: "Cartao de debito",
  CARTAO_CREDITO: "Cartao de credito",
  BOLETO: "Boleto",
  FIADO: "Caderno",
  CADERNO: "Caderno",
};

export function paymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return PAYMENT_LABELS[method] ?? method;
}

function companyAddressLine(company: SaleDocumentCompany): string | null {
  const parts = [company.endereco, company.numero, company.bairro, company.cidade, company.uf].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function deliveryAddressLine(delivery: SaleDocumentDelivery): string | null {
  const parts = [delivery.endereco, delivery.numero, delivery.bairro, delivery.cidade, delivery.uf].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Gera o PDF de orcamento ou venda direto na resposta HTTP (streaming, sem
 * arquivo temporario). O mesmo layout serve pros dois casos - so o titulo e
 * a secao de pagamento mudam - porque no sistema um orcamento e uma venda
 * sao o mesmo registro (Sale), so muda o status.
 */
export function renderSaleDocument(res: Response, company: SaleDocumentCompany, sale: SaleDocumentData) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const title = sale.isBudget ? "ORCAMENTO" : "VENDA";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${title.toLowerCase()}-${sale.number}.pdf"`);
  doc.pipe(res);

  // Cabecalho: logo da loja tem muito mais destaque que a marca do sistema.
  let headerTextX = 40;
  if (company.logoData) {
    try {
      doc.image(company.logoData, 40, 40, { fit: [90, 60] });
      headerTextX = 145;
    } catch {
      // logo corrompido/formato nao suportado pelo pdfkit - segue sem imagem
    }
  }

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(company.nomeFantasia || company.name, headerTextX, 40, { width: 380 });

  doc.fontSize(9).font("Helvetica").fillColor("#444444");
  if (company.razaoSocial) doc.text(company.razaoSocial, headerTextX);
  if (company.cnpj) doc.text(`CNPJ: ${company.cnpj}`, headerTextX);
  if (company.telefone) doc.text(`Tel: ${company.telefone}`, headerTextX);
  const companyAddress = companyAddressLine(company);
  if (companyAddress) doc.text(companyAddress, headerTextX);

  doc.fillColor("#000000");
  doc.moveDown(1.5);

  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(`${title} No ${sale.number}`, 40, 130, { align: "right" });

  doc.moveTo(40, 155).lineTo(555, 155).strokeColor("#cccccc").stroke();

  // Dados do cliente
  let y = 165;
  doc.fontSize(10).font("Helvetica-Bold").text("Dados", 40, y);
  y += 15;
  doc.font("Helvetica").fontSize(9);
  doc.text(`Data: ${formatDate(sale.createdAt)}`, 40, y);
  y += 13;
  doc.text(`Cliente: ${sale.customerName ?? "Consumidor final"}`, 40, y);
  y += 13;
  if (sale.customerDocument) {
    doc.text(`CPF/CNPJ: ${sale.customerDocument}`, 40, y);
    y += 13;
  }
  if (sale.customerPhone) {
    doc.text(`Telefone: ${sale.customerPhone}`, 40, y);
    y += 13;
  }
  if (sale.customerAddress) {
    doc.text(`Endereco: ${sale.customerAddress}`, 40, y);
    y += 13;
  }

  y += 10;

  // Tabela de itens
  const colX = { produto: 40, qtd: 300, unid: 350, valorUnit: 400, total: 480 };
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Produto", colX.produto, y);
  doc.text("Qtd", colX.qtd, y);
  doc.text("Unid.", colX.unid, y);
  doc.text("Valor unit.", colX.valorUnit, y);
  doc.text("Total", colX.total, y);
  y += 12;
  doc.moveTo(40, y).lineTo(555, y).strokeColor("#cccccc").stroke();
  y += 6;

  doc.font("Helvetica").fontSize(9);
  for (const item of sale.items) {
    if (y > 720) {
      doc.addPage();
      y = 40;
    }
    doc.text(item.productName, colX.produto, y, { width: 250 });
    doc.text(item.quantity, colX.qtd, y);
    doc.text(item.unitAbbreviation, colX.unid, y);
    doc.text(formatCurrency(Number(item.unitPrice)), colX.valorUnit, y);
    doc.text(formatCurrency(Number(item.total)), colX.total, y);
    y += 16;
  }

  y += 8;
  doc.moveTo(40, y).lineTo(555, y).strokeColor("#cccccc").stroke();
  y += 10;

  // Totais
  const totalsX = 400;
  doc.font("Helvetica").fontSize(9);
  doc.text("Subtotal:", totalsX, y);
  doc.text(formatCurrency(Number(sale.subtotal)), 480, y);
  y += 14;
  doc.text("Desconto:", totalsX, y);
  doc.text(`-${formatCurrency(Number(sale.discount))}`, 480, y);
  y += 14;
  doc.text("Frete:", totalsX, y);
  doc.text(formatCurrency(Number(sale.freight)), 480, y);
  y += 16;
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text("TOTAL:", totalsX, y);
  doc.text(formatCurrency(Number(sale.total)), 480, y);
  y += 25;

  // Forma de pagamento (so na venda confirmada)
  if (!sale.isBudget && sale.paymentMethodLabel) {
    doc.font("Helvetica-Bold").fontSize(10).text("Pagamento", 40, y);
    y += 14;
    doc.font("Helvetica").fontSize(9);
    doc.text(`Forma de pagamento: ${sale.paymentMethodLabel}`, 40, y);
    y += 13;
    if (sale.installmentTotal && sale.installmentTotal > 1) {
      doc.text(`Parcelas: ${sale.installmentTotal}x`, 40, y);
      y += 13;
    }
    y += 8;
  }

  // Entrega
  if (sale.delivery) {
    doc.font("Helvetica-Bold").fontSize(10).text("Entrega", 40, y);
    y += 14;
    doc.font("Helvetica").fontSize(9);
    if (sale.delivery.scheduledDate) {
      doc.text(`Entrega prevista: ${formatDate(sale.delivery.scheduledDate)}`, 40, y);
      y += 13;
    }
    const deliveryAddress = deliveryAddressLine(sale.delivery);
    if (deliveryAddress) {
      doc.text(`Endereco de entrega: ${deliveryAddress}`, 40, y);
      y += 13;
    }
    if (sale.delivery.notes) {
      doc.text(`Observacao: ${sale.delivery.notes}`, 40, y, { width: 500 });
      y += 13;
    }
    y += 8;
  }

  // Observacoes gerais
  if (sale.notes) {
    doc.font("Helvetica-Bold").fontSize(10).text("Observacoes", 40, y);
    y += 14;
    doc.font("Helvetica").fontSize(9).text(sale.notes, 40, y, { width: 500 });
  }

  // Rodape discreto - a marca do software, bem menor que a da loja. Fica
  // colado ao fim util da pagina atual (nao um Y fixo, que em paginas A4
  // sem conteudo suficiente sobraria uma pagina em branco so pra ele).
  const footerY = doc.page.height - doc.page.margins.bottom - 12;
  doc
    .fontSize(7)
    .fillColor("#999999")
    .text(`Sistema fornecido por ${APP_BRAND_NAME}`, 40, footerY, { align: "center", width: 515, lineBreak: false });

  doc.end();
}
