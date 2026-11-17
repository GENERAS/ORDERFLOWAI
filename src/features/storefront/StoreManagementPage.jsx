import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Package,
  Save,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { formatCurrency } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  deleteStoreLogo,
  getStoreLogoUrl,
  getStoreProfile,
  mapStoreProfile,
  searchStorefrontManagementProducts,
  setStorefrontProductVisibility,
  toStorefrontServiceError,
  updateStoreProfile,
  uploadStoreLogo,
} from './storefrontService';

const EMPTY_STORE = {
  slug: '',
  name: '',
  description: '',
  contactEmail: '',
  contactPhone: '',
  contactAddress: '',
  showContact: false,
  brandColor: '#4f46e5',
  status: 'active',
  logoPath: '',
};

export default function StoreManagementPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [store, setStore] = useState(null);
  const [form, setForm] = useState(EMPTY_STORE);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  const [products, setProducts] = useState([]);
  const [productSearchInput, setProductSearchInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productError, setProductError] = useState('');
  const [updatingProductId, setUpdatingProductId] = useState(null);

  const loadProducts = useCallback(async () => {
    if (!businessId) return;
    setProductsLoading(true);
    try {
      const result = await searchStorefrontManagementProducts({
        businessId,
        search: productSearch,
        limit: 100,
      });
      setProducts(result.data);
      setProductError('');
    } catch (loadError) {
      setProductError(toStorefrontServiceError(loadError).message);
    } finally {
      setProductsLoading(false);
    }
  }, [businessId, productSearch]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    getStoreProfile(businessId)
      .then(async (profile) => {
        const mapped = mapStoreProfile(profile);
        let preview = null;
        if (mapped?.logoPath) {
          try {
            preview = await getStoreLogoUrl(mapped.logoPath);
          } catch {
            preview = null;
          }
        }
        if (!active) return;
        setStore(mapped);
        if (mapped) {
          setForm({
            slug: mapped.slug,
            name: mapped.name,
            description: mapped.description,
            contactEmail: mapped.contactEmail,
            contactPhone: mapped.contactPhone,
            contactAddress: mapped.contactAddress,
            showContact: mapped.showContact,
            brandColor: mapped.brandColor,
            status: mapped.status,
            logoPath: mapped.logoPath ?? '',
          });
          setLogoPreview(preview);
        }
        setError('');
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(toStorefrontServiceError(loadError).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProductSearch(productSearchInput.trim());
      setProductsLoading(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [productSearchInput]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadProducts();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadProducts]);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const storeUrl = store?.slug
    ? `${window.location.origin}/store/${store.slug}`
    : '';

  const handleCopy = async () => {
    if (!storeUrl) return;
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed. Select the link and copy it manually.');
    }
  };

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    setLogoFile(file);
    if (file) setLogoPreview(URL.createObjectURL(file));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!businessId) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      let logoPath = form.logoPath || '';
      if (logoFile) {
        logoPath = await uploadStoreLogo({ businessId, file: logoFile });
      }

      const profile = await updateStoreProfile({
        businessId,
        ...form,
        logoPath,
      });

      if (logoFile && form.logoPath && form.logoPath !== logoPath) {
        await deleteStoreLogo(form.logoPath);
      }

      const preview = profile.logoPath ? await getStoreLogoUrl(profile.logoPath) : null;
      setStore(profile);
      setForm({
        slug: profile.slug,
        name: profile.name,
        description: profile.description,
        contactEmail: profile.contactEmail,
        contactPhone: profile.contactPhone,
        contactAddress: profile.contactAddress,
        showContact: profile.showContact,
        brandColor: profile.brandColor,
        status: profile.status,
        logoPath: profile.logoPath ?? '',
      });
      setLogoPreview(preview);
      setLogoFile(null);
      setSuccess('Online store settings saved.');
    } catch (saveError) {
      setError(toStorefrontServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProduct = async (product) => {
    setUpdatingProductId(product.id);
    setProductError('');
    try {
      await setStorefrontProductVisibility(product.id, !product.storefrontVisible);
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id
            ? { ...item, storefrontVisible: !item.storefrontVisible }
            : item,
        ),
      );
    } catch (toggleError) {
      setProductError(toStorefrontServiceError(toggleError).message);
    } finally {
      setUpdatingProductId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-slate-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading online store…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
          Sales channel
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Online store
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Configure the public storefront for this business and choose which real catalogue products
          customers can see and order.
        </p>
      </div>

      {error ? <Alert variant="error" title="Store request failed">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <form
          onSubmit={handleSave}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Store profile</h2>
              <p className="mt-1 text-sm text-slate-500">
                This information appears on your public storefront.
              </p>
            </div>
            <Badge variant={form.status === 'active' ? 'success' : 'neutral'}>
              {form.status === 'active' ? 'Live' : 'Deactivated'}
            </Badge>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Store name"
              required
              value={form.name}
              onChange={updateField('name')}
            />
            <FormField
              label="Store link name"
              required
              value={form.slug}
              onChange={updateField('slug')}
              hint="Lowercase letters, numbers and hyphens."
            />
            <div className="sm:col-span-2">
              <label htmlFor="store-description" className="block text-sm font-medium text-slate-700">
                Store description
              </label>
              <textarea
                id="store-description"
                rows={4}
                value={form.description}
                onChange={updateField('description')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                placeholder="Tell customers what this business offers"
              />
            </div>

            <FormField
              label="Brand color"
              type="color"
              value={form.brandColor}
              onChange={updateField('brandColor')}
              className="h-20"
              inputClassName="h-12 w-24 p-1"
            />
            <div>
              <label htmlFor="store-status" className="block text-sm font-medium text-slate-700">
                Store status
              </label>
              <select
                id="store-status"
                value={form.status}
                onChange={updateField('status')}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="active">Active — public can browse and order</option>
                <option value="inactive">Inactive — public access blocked</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-slate-700">Store logo</p>
              <div className="mt-2 flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Store logo preview" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-7 w-7 text-slate-300" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload logo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      onChange={handleLogoChange}
                    />
                  </label>
                  <p className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP or AVIF up to 5 MB.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-900">Published contact information</h3>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.showContact}
                onChange={updateField('showContact')}
                className="h-4 w-4 rounded border-slate-300"
              />
              Show these contact details on the public store
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField
                label="Public email"
                type="email"
                value={form.contactEmail}
                onChange={updateField('contactEmail')}
              />
              <FormField
                label="Public phone"
                value={form.contactPhone}
                onChange={updateField('contactPhone')}
              />
              <FormField
                className="sm:col-span-2"
                label="Public address"
                value={form.contactAddress}
                onChange={updateField('contactAddress')}
              />
            </div>
          </div>

          <div className="mt-7 flex justify-end border-t border-slate-200 pt-6">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Save store settings
            </Button>
          </div>
        </form>

        <aside className="h-fit space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Your store link</h2>
            <p className="mt-1 text-sm text-slate-500">Share this link with customers.</p>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm break-all text-slate-700">
              {storeUrl || 'Save your store to create a link.'}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={handleCopy} disabled={!storeUrl}>
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              {storeUrl ? (
                <Link
                  to={`/store/${store.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Button>
              )}
            </div>
            {store?.status === 'inactive' ? (
              <Alert className="mt-4" variant="warning">
                Your store is deactivated. Customers cannot open it until you activate it again.
              </Alert>
            ) : null}
          </div>
        </aside>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Public catalogue</h2>
            <p className="mt-1 text-sm text-slate-500">
              Only active products you publish here appear in your online store.
            </p>
          </div>
          <FormField
            className="w-full sm:w-72"
            label="Search products"
            type="search"
            value={productSearchInput}
            onChange={(event) => setProductSearchInput(event.target.value)}
            placeholder="Search catalogue"
          />
        </div>

        {productError ? <Alert className="mt-5" variant="error">{productError}</Alert> : null}

        {productsLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-600">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Loading products…
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={Package}
            title="No products found"
            description="Add and activate products in the catalogue, then publish them here."
          />
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-3 pr-4">Product</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Price</th>
                  <th className="py-3 pr-4">Store visibility</th>
                  <th className="py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{product.name}</p>
                          {product.sku ? <p className="text-xs text-slate-500">{product.sku}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={product.status === 'active' ? 'success' : 'neutral'}>
                        {product.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {formatCurrency(product.price, { currency: product.currency })}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={product.storefrontVisible ? 'brand' : 'neutral'}>
                        {product.storefrontVisible ? 'Published' : 'Hidden'}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={updatingProductId === product.id || product.status !== 'active'}
                        onClick={() => handleToggleProduct(product)}
                      >
                        {updatingProductId === product.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : product.storefrontVisible ? (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {product.storefrontVisible ? 'Hide' : 'Publish'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
