export const readPermissionMatrix = (payload) => {
  const matrix = payload?.matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw Object.assign(
      new Error('The permissions API returned an invalid response.'),
      { code: 'INVALID_PERMISSION_MATRIX_RESPONSE' },
    );
  }
  return matrix;
};

export default readPermissionMatrix;
