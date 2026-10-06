import { api, postFormData } from './apiClient';

export const documentBrandingApi = {
  getAdminLogos: () => api.get('/document-branding/admin/logos'),
  uploadLogo: (logoType, file) => {
    const form = new FormData();
    form.append('file', file);
    return postFormData(`/document-branding/admin/logos/${encodeURIComponent(logoType)}`, form);
  },
  removeLogo: (logoType) =>
    api.delete(`/document-branding/admin/logos/${encodeURIComponent(logoType)}`),
  forDocument: (documentType) =>
    api.get(`/document-branding/for/${encodeURIComponent(documentType)}`),
};

export default documentBrandingApi;
