import { useEffect, useState } from 'react';
import { documentBrandingApi } from '@/services/api/documentBrandingApi';

const loadLogoData = (logo) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    try {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('The configured logo has no image dimensions.');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the configured logo for document output.');
      context.drawImage(image, 0, 0);
      resolve({ ...logo, dataUrl: canvas.toDataURL('image/png'), width, height });
    } catch (error) {
      reject(new Error(`Could not prepare the ${logo.type} logo for document output: ${error.message}`));
    } finally {
    }
  };
  image.onerror = () => reject(new Error(`Could not load the configured ${logo.type} logo.`));
  image.src = logo.dataUrl;
});

export const loadDocumentBranding = async (documentType) => {
  const branding = await documentBrandingApi.forDocument(documentType);
  const loaded = await Promise.all(
    Object.values(branding.logos || {}).map(loadLogoData),
  );
  return {
    ...branding,
    logos: Object.fromEntries(loaded.map((logo) => [logo.type, logo])),
  };
};

export const useDocumentBranding = (documentType) => {
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBranding(null);
    setError('');
    loadDocumentBranding(documentType)
      .then((result) => active && setBranding(result))
      .catch((loadError) => active && setError(loadError?.message || 'Could not load document branding.'));
    return () => {
      active = false;
    };
  }, [documentType]);

  return { branding, error };
};

export default loadDocumentBranding;
