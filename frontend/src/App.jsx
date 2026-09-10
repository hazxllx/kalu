import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router } from 'react-router-dom';

import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider } from '@/context/AuthContext';
import { PermissionsProvider } from '@/context/PermissionsContext';
import { PhnCoverageProvider } from '@/context/PhnCoverageContext';
import { ThemeProvider } from '@/context/ThemeContext';
import ScrollToTop from '@/routes/ScrollToTop';
import AppRoutes from '@/routes/AppRoutes';

/**
 * Application shell: global providers only.
 * The route table lives in `@/routes/AppRoutes`.
 */
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PhnCoverageProvider>
          <PermissionsProvider>
            <QueryClientProvider client={queryClientInstance}>
              <Router>
                <ScrollToTop />
                <AppRoutes />
              </Router>
              <Toaster />
            </QueryClientProvider>
          </PermissionsProvider>
        </PhnCoverageProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
