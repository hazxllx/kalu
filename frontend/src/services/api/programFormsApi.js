import { api } from './apiClient';

/**
 * Program-specific official TCL / health forms API.
 *
 *   /program-forms/ncd-risk        NCD Part 1 - Risk-Assessed Adults
 *   /program-forms/ncd-cervical    NCD Part 2 - Cervical CA & Breast Mass Exam
 *   /program-forms/ncd-visual      NCD Part 3 - Visual Acuity & PPV
 *   /program-forms/oral-health     Oral Health TCL (+ /statistics ST table)
 *   /program-forms/environmental   Environmental Health Masterlist (household)
 *
 * The backend splits a flat record into first-class columns and a validated
 * `data` jsonb payload, so the client always sends/receives a flat object.
 */
const resource = (kind) => ({
  list: (params) => api.get(`/program-forms/${kind}`, { params }),
  create: (record, options) => api.post(`/program-forms/${kind}`, { record }, options),
  update: (id, record, options) => api.put(`/program-forms/${kind}/${id}`, { record }, options),
  remove: (id) => api.delete(`/program-forms/${kind}/${id}`),
});

export const ncdRiskApi = resource('ncd-risk');
export const ncdCervicalApi = resource('ncd-cervical');
export const ncdVisualApi = resource('ncd-visual');
export const oralHealthApi = {
  ...resource('oral-health'),
  statistics: (params) => api.get('/program-forms/oral-health/statistics', { params }),
};
export const environmentalApi = resource('environmental');

export const programFormsApi = {
  'ncd-risk': ncdRiskApi,
  'ncd-cervical': ncdCervicalApi,
  'ncd-visual': ncdVisualApi,
  'oral-health': oralHealthApi,
  environmental: environmentalApi,
};

export default programFormsApi;
