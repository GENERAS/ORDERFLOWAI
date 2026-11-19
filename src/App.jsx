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
const AssistantPage = lazy(() => import('./features/ai/AssistantPage'));
const InboxPage = lazy(() => import('./features/inbox/InboxPage'));
const ChannelsPage = lazy(() => import('./features/channels/ChannelsPage'));
const OrdersPage = lazy(() => import('./features/orders/OrdersPage'));
const OrderEditorPage = lazy(
  () => import('./features/orders/OrderEditorPage'),
);
const OrderDetailPage = lazy(
  () => import('./features/orders/OrderDetailPage'),
);
const ProductsPage = lazy(() => import('./features/products/ProductsPage'));
const ProductEditorPage = lazy(
  () => import('./features/products/ProductEditorPage'),
);
const CategoriesPage = lazy(() => import('./features/products/CategoriesPage'));
const BrandsPage = lazy(() => import('./features/products/BrandsPage'));
const AttributesPage = lazy(() => import('./features/products/AttributesPage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const InventoryItemPage = lazy(
  () => import('./features/inventory/InventoryItemPage'),
);
const StockMovementsPage = lazy(
  () => import('./features/inventory/StockMovementsPage'),
);
const CustomersPage = lazy(() => import('./features/customers/CustomersPage'));
const CustomerEditorPage = lazy(
  () => import('./features/customers/CustomerEditorPage'),
);
const CustomerDetailPage = lazy(
  () => import('./features/customers/CustomerDetailPage'),
);
const PaymentsPage = lazy(() => import('./features/payments/PaymentsPage'));
const RecordPaymentPage = lazy(
  () => import('./features/payments/RecordPaymentPage'),
);
const PaymentDetailPage = lazy(
  () => import('./features/payments/PaymentDetailPage'),
);
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const TeamPage = lazy(() => import('./features/team/TeamPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const StoreManagementPage = lazy(
  () => import('./features/storefront/StoreManagementPage'),
);
const StorefrontLayout = lazy(
  () => import('./features/storefront/StorefrontLayout'),
);
const PublicStorefrontPage = lazy(
  () => import('./features/storefront/PublicStorefrontPage'),
);
const StorefrontProductPage = lazy(
  () => import('./features/storefront/StorefrontProductPage'),
);
const StorefrontCheckoutPage = lazy(
  () => import('./features/storefront/StorefrontCheckoutPage'),
);
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

            <Route path="store/:storeSlug" element={<StorefrontLayout />}>
              <Route index element={<PublicStorefrontPage />} />
              <Route path="products/:productId" element={<StorefrontProductPage />} />
              <Route path="checkout" element={<StorefrontCheckoutPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="workspaces" element={<WorkspacesPage />} />

              <Route element={<RequireWorkspace />}>
                <Route element={<AppLayout />}>
                  <Route path="overview" element={<DashboardPage />} />
                  <Route path="assistant" element={<AssistantPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="channels" element={<ChannelsPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="orders/new" element={<OrderEditorPage />} />
                  <Route
                    path="orders/:orderId"
                    element={<OrderDetailPage />}
                  />
                  <Route
                    path="orders/:orderId/edit"
                    element={<OrderEditorPage />}
                  />
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
                  <Route
                    path="inventory/movements"
                    element={<StockMovementsPage />}
                  />
                  <Route
                    path="inventory/items/:inventoryItemId"
                    element={<InventoryItemPage />}
                  />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route
                    path="customers/new"
                    element={<CustomerEditorPage />}
                  />
                  <Route
                    path="customers/:customerId"
                    element={<CustomerDetailPage />}
                  />
                  <Route
                    path="customers/:customerId/edit"
                    element={<CustomerEditorPage />}
                  />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="payments/new" element={<RecordPaymentPage />} />
                  <Route
                    path="payments/:paymentId"
                    element={<PaymentDetailPage />}
                  />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route
                    path="store"
                    element={<StoreManagementPage />}
                  />
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
