import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { PageLoader } from './components/ui/PageLoader';
import { AuthProvider } from './features/auth/AuthProvider';
import { AuthLayout } from './features/auth/AuthLayout';
import { RequireAuth, RequireWorkspace, RootRedirect } from './features/auth/guards';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('./features/auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage'));
const AuthCallbackPage = lazy(() => import('./features/auth/AuthCallbackPage'));
const OnboardingPage = lazy(() => import('./features/onboarding/OnboardingPage'));
const WorkspacesPage = lazy(() => import('./features/workspaces/WorkspacesPage'));

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const InboxPage = lazy(() => import('./features/inbox/InboxPage'));
const OrdersPage = lazy(() => import('./features/orders/OrdersPage'));
const ProductsPage = lazy(() => import('./features/products/ProductsPage'));
const ProductEditorPage = lazy(
  () => import('./features/products/ProductEditorPage'),
);
const CategoriesPage = lazy(() => import('./features/products/CategoriesPage'));
const BrandsPage = lazy(() => import('./features/products/BrandsPage'));
const AttributesPage = lazy(() => import('./features/products/AttributesPage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const CustomersPage = lazy(() => import('./features/customers/CustomersPage'));
const PaymentsPage = lazy(() => import('./features/payments/PaymentsPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const TeamPage = lazy(() => import('./features/team/TeamPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const NotFoundPage = lazy(() => import('./features/not-found/NotFoundPage'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<AuthLayout />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="verify-email" element={<VerifyEmailPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route path="auth/callback" element={<AuthCallbackPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="workspaces" element={<WorkspacesPage />} />

              <Route element={<RequireWorkspace />}>
                <Route element={<AppLayout />}>
                  <Route path="overview" element={<DashboardPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/new" element={<ProductEditorPage />} />
                  <Route
                    path="products/categories"
                    element={<CategoriesPage />}
                  />
                  <Route path="products/brands" element={<BrandsPage />} />
                  <Route
                    path="products/attributes"
                    element={<AttributesPage />}
                  />
                  <Route
                    path="products/:productId/edit"
                    element={<ProductEditorPage />}
                  />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="/" element={<RootRedirect />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
