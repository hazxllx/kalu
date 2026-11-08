import api from './apiClient';

const aggregate = (value, arrays, summary = true) => {
  if (!value || (summary && !value.summary) || arrays.some((key) => !Array.isArray(value[key]))) {
    throw new Error('The authorized aggregate response was incomplete.');
  }
  return value;
};
const paramsFor = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== 'All'));

export const authorizedViewsApi = {
  earlyWarning: async (params, options) => aggregate(await api.get('/analytics/early-warning', { ...options, params: paramsFor(params) }), ['consultationTrends', 'diseaseDistribution', 'riskDistribution']),
  communityMap: async (params, options) => aggregate(await api.get('/analytics/community-map', { ...options, params: paramsFor(params) }), ['barangays', 'conditionTotals']),
  communityTrends: async (params, options) => aggregate(await api.get('/analytics/community-map/trends', { ...options, params: paramsFor(params) }), ['monthly'], false),
  conditions: async (options) => {
    const result = aggregate(await api.get('/analytics/conditions', options), ['conditions'], false);
    return result.conditions;
  },
};
