import https from "https";
import zlib from "zlib";
import { XMLParser } from "fast-xml-parser";
import { AppError } from "../utils/AppError";

/**
 * Client for the SEFAZ "NFe Distribuicao DFe" webservice - the national
 * (AN) service that lets a CNPJ discover, as the destinatario, every NFe
 * issued against it (the "radar" of incoming invoices). Authentication is
 * mutual TLS with the company's A1 certificate, not a login/token.
 *
 * IMPORTANT: this was written strictly from the public SEFAZ webservice
 * documentation/XSD (distDFeInt_v1.01) - it could not be exercised against
 * the real SEFAZ endpoint from the development sandbox (no network egress
 * to gov.br domains there). Validate end-to-end after deploying, using a
 * real certificate, before relying on it in production.
 */

const UF_CODES: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};

const ENDPOINTS = {
  PRODUCAO: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  HOMOLOGACAO: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
} as const;

type Ambiente = keyof typeof ENDPOINTS;

export interface SefazCredentials {
  pfx: Buffer;
  passphrase: string;
}

export interface ItemNfe {
  codigoProduto: string;
  descricao: string;
  unidadeComercial: string;
  quantidadeComercial: number;
  valorUnitarioComercial: number;
  valorTotal: number;
}

export interface DuplicataNfe {
  numero: string;
  vencimento: string;
  valor: number;
}

export interface NfeCompleta {
  chaveAcesso: string;
  numero: string;
  dataEmissao: Date;
  valorTotal: number;
  emitenteCnpj: string;
  emitenteNome: string;
  itens: ItemNfe[];
  duplicatas: DuplicataNfe[];
}

interface ResumoDocumento {
  nsu: string;
  schema: string;
  xml: string;
}

export interface DistDfeCheckResult {
  ultNSU: string;
  maxNSU: string;
  chavesEncontradas: string[];
}

function getUfCode(uf: string): number {
  const code = UF_CODES[uf.toUpperCase()];
  if (!code) throw new AppError(`UF invalida: "${uf}"`, 422);
  return code;
}

function buildEnvelope(distDfeIntXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    "<soap12:Body>" +
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
    `<nfeDadosMsg>${distDfeIntXml}</nfeDadosMsg>` +
    "</nfeDistDFeInteresse>" +
    "</soap12:Body>" +
    "</soap12:Envelope>"
  );
}

function buildDistNsuPayload(cnpj: string, uf: string, ambiente: Ambiente, ultNsu: string): string {
  const tpAmb = ambiente === "PRODUCAO" ? 1 : 2;
  return (
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${getUfCode(uf)}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${ultNsu.padStart(15, "0")}</ultNSU></distNSU>` +
    "</distDFeInt>"
  );
}

function buildConsChNfePayload(cnpj: string, uf: string, ambiente: Ambiente, chave: string): string {
  const tpAmb = ambiente === "PRODUCAO" ? 1 : 2;
  return (
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${getUfCode(uf)}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<consChNFe><chNFe>${chave}</chNFe></consChNFe>` +
    "</distDFeInt>"
  );
}

function postToSefaz(credentials: SefazCredentials, ambiente: Ambiente, payloadXml: string): Promise<string> {
  const envelope = buildEnvelope(payloadXml);
  const endpoint = new URL(ENDPOINTS[ambiente]);

  let agent: https.Agent;
  try {
    agent = new https.Agent({
      pfx: credentials.pfx,
      passphrase: credentials.passphrase,
      minVersion: "TLSv1.2",
    });
  } catch {
    throw new AppError(
      "Certificado ou senha invalidos - nao foi possivel preparar a conexao segura com a SEFAZ.",
      422,
    );
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: endpoint.hostname,
        path: endpoint.pathname,
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(envelope),
        },
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", reject);
      },
    );

    request.on("timeout", () => request.destroy(new Error("Tempo esgotado ao contatar a SEFAZ")));
    request.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/certificate|SSL|handshake/i.test(message)) {
        reject(
          new AppError(
            "Falha de autenticacao com o certificado digital junto a SEFAZ. Verifique se o certificado nao expirou e se a senha esta correta.",
            422,
          ),
        );
      } else {
        reject(error);
      }
    });

    request.write(envelope);
    request.end();
  });
}

function extractLeaf(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return match ? match[1] : null;
}

function extractDocZips(xml: string): ResumoDocumento[] {
  const documents: ResumoDocumento[] = [];
  const regex = /<docZip\s+NSU="(\d+)"\s+schema="([^"]+)">([^<]+)<\/docZip>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const [, nsu, schema, base64] = match;
    const xmlContent = zlib.gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
    documents.push({ nsu, schema, xml: xmlContent });
  }

  return documents;
}

/**
 * Step 1 of the radar: ask SEFAZ, since the last known NSU cursor, for
 * everything new. This typically returns lightweight "resNFe" summaries
 * (just the access key), not the itemized document.
 */
export async function checkForNewInvoices(
  credentials: SefazCredentials,
  cnpj: string,
  uf: string,
  ambiente: Ambiente,
  ultNsu: string,
): Promise<DistDfeCheckResult> {
  const responseXml = await postToSefaz(
    credentials,
    ambiente,
    buildDistNsuPayload(cnpj, uf, ambiente, ultNsu),
  );

  const cStat = extractLeaf(responseXml, "cStat");
  const xMotivo = extractLeaf(responseXml, "xMotivo") ?? "Resposta invalida da SEFAZ";

  // 137 = nenhum documento novo localizado; 138 = documento(s) localizado(s).
  if (cStat !== "137" && cStat !== "138") {
    throw new AppError(`SEFAZ retornou status ${cStat}: ${xMotivo}`, 502);
  }

  const newUltNsu = extractLeaf(responseXml, "ultNSU") ?? ultNsu;
  const maxNsu = extractLeaf(responseXml, "maxNSU") ?? newUltNsu;

  const chaves = extractDocZips(responseXml)
    .filter((doc) => doc.schema.startsWith("resNFe"))
    .map((doc) => extractLeaf(doc.xml, "chNFe"))
    .filter((chave): chave is string => Boolean(chave));

  return { ultNSU: newUltNsu, maxNSU: maxNsu, chavesEncontradas: chaves };
}

const itemParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "det" || name === "dup",
});

/**
 * Step 2 of the radar: for a specific access key found in step 1, ask
 * SEFAZ again (consChNFe) to get the complete document with items and
 * installments - the summary from step 1 does not include those.
 */
export async function fetchFullInvoice(
  credentials: SefazCredentials,
  cnpj: string,
  uf: string,
  ambiente: Ambiente,
  chaveAcesso: string,
): Promise<NfeCompleta | null> {
  const responseXml = await postToSefaz(
    credentials,
    ambiente,
    buildConsChNfePayload(cnpj, uf, ambiente, chaveAcesso),
  );

  const cStat = extractLeaf(responseXml, "cStat");
  if (cStat !== "138") {
    return null;
  }

  const fullDoc = extractDocZips(responseXml).find(
    (doc) => doc.schema.startsWith("procNFe") || doc.schema.startsWith("nfeProc"),
  );
  if (!fullDoc) return null;

  const parsed = itemParser.parse(fullDoc.xml);
  const nfeProc = parsed.nfeProc ?? parsed;
  const infNFe = nfeProc.NFe?.infNFe ?? nfeProc.infNFe;
  if (!infNFe) return null;

  const det: any[] = infNFe.det ?? [];
  const dup: any[] = infNFe.cobr?.dup ?? [];

  return {
    chaveAcesso,
    numero: String(infNFe.ide.nNF),
    dataEmissao: new Date(infNFe.ide.dhEmi),
    valorTotal: Number(infNFe.total.ICMSTot.vNF),
    emitenteCnpj: String(infNFe.emit.CNPJ ?? infNFe.emit.CPF ?? ""),
    emitenteNome: String(infNFe.emit.xNome),
    itens: det.map((item) => ({
      codigoProduto: String(item.prod.cProd),
      descricao: String(item.prod.xProd),
      unidadeComercial: String(item.prod.uCom),
      quantidadeComercial: Number(item.prod.qCom),
      valorUnitarioComercial: Number(item.prod.vUnCom),
      valorTotal: Number(item.prod.vProd),
    })),
    duplicatas: dup.map((item) => ({
      numero: String(item.nDup ?? ""),
      vencimento: String(item.dVenc),
      valor: Number(item.vDup),
    })),
  };
}
