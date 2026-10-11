import crypto from 'node:crypto';

// Cifrado simétrico de campo (AES-256-GCM). En V1 la llave vive en una variable de
// entorno; cuando el volumen lo justifique, cámbiala por AWS KMS / GCP KMS / Vault
// sin tocar el resto del código: solo reescribes getKey().
//
// CLINICAL_ENCRYPTION_KEY debe ser 32 bytes en base64. Generar una:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const KEY_VERSIONS = {
  1: process.env.CLINICAL_ENCRYPTION_KEY,
};
export const CURRENT_KEY_VERSION = 1;

function getKey(version) {
  const b64 = KEY_VERSIONS[version];
  if (!b64) throw new Error(`No hay llave de cifrado para la versión ${version}`);
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CLINICAL_ENCRYPTION_KEY debe decodificar a 32 bytes');
  return key;
}

/** Cifra un objeto JS cualquiera. Devuelve { keyVersion, iv, authTag, ciphertext } en base64/hex. */
export function encryptField(plainObject, keyVersion = CURRENT_KEY_VERSION) {
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(keyVersion), iv);
  const plaintext = Buffer.from(JSON.stringify(plainObject), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    keyVersion,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Inverso de encryptField. Lanza si authTag no coincide (contenido alterado o llave equivocada). */
export function decryptField({ keyVersion, iv, authTag, ciphertext }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(keyVersion), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
