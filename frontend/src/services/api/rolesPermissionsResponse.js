export const readPermissionMatrix = (payload) => {
  const matrix = payload?.matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    const error = new Error('The permissions API returned an invalid response.');
    error.code = 'INVALID_PERMISSION_MATRIX_RESPONSE';
    throw error;
  }
  return matrix;
};

export default readPermissionMatrix;
