export const readPermissionMatrix = (payload) => {
  const matrix = payload?.matrix;
  const valid =
    matrix &&
    typeof matrix === 'object' &&
    !Array.isArray(matrix) &&
    Object.values(matrix).every(
      (permissions) =>
        permissions &&
        typeof permissions === 'object' &&
        !Array.isArray(permissions) &&
        Object.values(permissions).every((granted) => typeof granted === 'boolean'),
    );
  if (!valid) {
    throw Object.assign(
      new Error('The permissions API returned an invalid response.'),
      { code: 'INVALID_PERMISSION_MATRIX_RESPONSE' },
    );
  }
  return matrix;
};

export default readPermissionMatrix;
