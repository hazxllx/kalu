import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router } from 'react-router-dom';

import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider } from '@/context/AuthContext';
import { PermissionsProvider } from '@/context/PermissionsContext';
import ScrollToTop from '@/routes/ScrollToTop';
import AppRoutes from '@/routes/AppRoutes';

/**
 * Application shell: global providers only.
 * The route table lives in `@/routes/AppRoutes`.
 */
function App() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <AppRoutes />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </PermissionsProvider>
    </AuthProvider>
  );
}

export default App;
