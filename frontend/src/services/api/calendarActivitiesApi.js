// frontend/src/services/api/calendarActivitiesApi.js
import { api } from './apiClient';

export const calendarActivitiesApi = {
  list: (params) => api.get('/calendar-activities', { params }),
  create: (record) => api.post('/calendar-activities', record),
  update: (id, record) => api.patch(`/calendar-activities/${id}`, record),
  remove: (id) => api.delete(`/calendar-activities/${id}`),
};

export default calendarActivitiesApi;
