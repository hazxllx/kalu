import { getServiceClient } from '../config/supabase.js';
import path from 'node:path';

const BUCKET = 'documents';

const safeExtension = (fileName, mimeType) => {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)
    ? ext
    : mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
  };

const storagePath = (residentId, documentId, fileName, prefix = 'resident-documents') =>
  `${prefix}/${residentId}/${documentId}${safeExtension(fileName, '')}`;

/**
 * Upload a file to the private documents bucket.
 * Returns the storage path and public URL (signed).
 */
export const uploadDocument = async ({ file, residentId, documentId }) => {
  const supabase = getServiceClient();
  const path = storagePath(residentId, documentId, file.name, 'resident-documents');

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: 'private, max-age=3600',
    upsert: false,
    contentType: file.type,
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).createSignedUrl(path, 3600);

  return {
    storagePath: path,
    url: urlData?.signedUrl || null,
  };
};

export const uploadTransferDocument = async ({ file, transferRequestId, documentId }) => {
  const supabase = getServiceClient();
  const path = storagePath(transferRequestId, documentId, file.name, 'transfer-documents');
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: 'private, max-age=3600', upsert: false, contentType: file.type,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return { storagePath: path, url: urlData?.signedUrl || null };
};

/**
 * Generate a fresh signed URL for an existing document.
 */
export const getDocumentSignedUrl = async (storagePath) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error) {
    throw new Error(`Cannot generate download link: ${error.message}`);
  }
  return data?.signedUrl || null;
};

/**
 * Delete a file from storage.
 */
export const deleteDocument = async (storagePath) => {
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
  return true;
};

export default { uploadDocument, uploadTransferDocument, getDocumentSignedUrl, deleteDocument, storagePath };
