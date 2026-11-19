// Only used with intercepted SDK transports; these are unsigned test fixtures.
export const configureLocalTestEnvironment = () => {
  const key = (role) => `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.test`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = key('anon');
  process.env.SUPABASE_SERVICE_ROLE_KEY = key('service_role');
};
