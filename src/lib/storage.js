import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';

// Compatible con Supabase Storage (S3-compatible endpoint), Cloudflare R2 o AWS S3 real:
// solo cambias las variables de entorno, el código no cambia.
const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,            // ej. https://<proj>.supabase.co/storage/v1/s3
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET || 'clinical-documents';

export function buildStorageKey(clinicalRecordId, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${clinicalRecordId}/${crypto.randomUUID()}-${safe}`;
}

/** URL firmada de SUBIDA (PUT), de corta duración, para que el navegador suba directo al bucket. */
export async function getUploadUrl(storageKey, mimeType, expiresInSeconds = 300) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: mimeType });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

/** URL firmada de LECTURA (GET), de corta duración — nunca una URL pública fija. */
export async function getDownloadUrl(storageKey, expiresInSeconds = 600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

export async function deleteObject(storageKey) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}
