// frontend/src/services/accessControl/permissionRequestPolicy.js
/** Match only the authenticated role-permissions read, never permission writes. */
export const isPermissionMatrixRequest = ({ url, request }) =>
  request?.method === 'GET' && /(?:^|\/)roles\/permissions\/?$/.test(url?.pathname || '');

export default isPermissionMatrixRequest;
