import forge from "node-forge";
import { AppError } from "../utils/AppError";

export interface CertificateInfo {
  subjectCommonName: string;
  validTo: Date;
}

/**
 * Validates a PKCS#12 (.pfx/.p12) buffer against the given password and
 * extracts display metadata. Throws AppError (422) when the file is not a
 * valid PKCS#12 container or the password does not match - this gives
 * immediate feedback on upload instead of a confusing failure later when
 * the radar tries to authenticate with SEFAZ.
 */
export function readCertificateInfo(pfxBuffer: Buffer, password: string): CertificateInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new AppError(
      "Nao foi possivel ler o certificado. Verifique se o arquivo (.pfx/.p12) e a senha estao corretos.",
      422,
    );
  }

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = bags[forge.pki.oids.certBag]?.[0];
  const cert = certBag?.cert;

  if (!cert) {
    throw new AppError("O arquivo enviado nao contem um certificado valido", 422);
  }

  const commonNameField = cert.subject.getField("CN");

  return {
    subjectCommonName: commonNameField ? commonNameField.value : "Certificado sem nome",
    validTo: cert.validity.notAfter,
  };
}
