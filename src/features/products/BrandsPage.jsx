import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Package,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { controlClasses, labelClasses } from '../../components/ui/formStyles';
import { useAuth } from '../auth/authContext';
import {
  deleteBrand,
  listBrands,
  saveBrand,
  toCatalogueServiceError,
} from '../../services/catalogueService';
import { cn } from '../../utils/cn';
import { canManageTaxonomy } from './catalogueUtils';

const EMPTY_FORM = {
  id: null,
  name: '',
  description: '',
};

export default function BrandsPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = canManageTaxonomy(activeMembership?.role);

  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setBrands(await listBrands(businessId));
  };

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    listBrands(businessId)
      .then((rows) => {
        if (!active) return;
        setBrands(rows);
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toCatalogueServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError('');
    setSuccess('');
  };

  const resetForm = () => setForm(EMPTY_FORM);

  const startEdit = (brand) => {
    setForm({
      id: brand.id,
      name: brand.name,
      description: brand.description ?? '',
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManage || saving) return;

    if (!form.name.trim()) {
      setError('Enter a brand name.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await saveBrand({
        id: form.id,
        businessId,
        name: form.name,
        description: form.description,
      });
      await load();
      setSuccess(form.id ? 'Brand updated.' : 'Brand created.');
      resetForm();
    } catch (saveError) {
      setError(toCatalogueServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (brand) => {
    if (!window.confirm(`Delete the brand "${brand.name}"?`)) return;

    setDeletingId(brand.id);
    setError('');
    setSuccess('');

    try {
      await deleteBrand({ id: brand.id, businessId });
      await load();
      if (form.id === brand.id) resetForm();
      setSuccess('Brand deleted.');
    } catch (deleteError) {
      setError(toCatalogueServiceError(deleteError).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="brands-title">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to catalogue
        </Link>
        <h2
          id="brands-title"
          className="mt-2 text-lg font-semibold tracking-tight text-slate-900"
        >
          Brands
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          Track the makers and labels behind the products in this workspace.
        </p>
      </div>

      {!canManage ? (
        <Alert variant="info">
          Your role can view brands. A manager, admin or owner can create and change
          them.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading brands…
            </div>
          ) : null}

          {!loading && brands.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No brands yet"
              description={
                canManage
                  ? 'Create your first brand using the form.'
                  : 'A manager or admin can create the first brand.'
              }
            />
          ) : null}

          {brands.map((brand) => {
            const isDeleting = deletingId === brand.id;
            return (
              <div
                key={brand.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {brand.name}
                    </p>
                    <Badge variant="neutral">
                      {brand.productCount} product
                      {brand.productCount === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  {brand.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {brand.description}
                    </p>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(brand)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(brand)}
                      disabled={isDeleting || brand.productCount > 0}
                      title={
                        brand.productCount > 0
                          ? 'Move products to another brand first.'
                          : undefined
                      }
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      {isDeleting ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {canManage ? (
          <Card className="h-fit">
            <CardHeader>
              <div>
                <CardTitle as="h3">
                  {form.id ? 'Edit brand' : 'New brand'}
                </CardTitle>
                <CardDescription>
                  {form.id
                    ? 'Update the brand details below.'
                    : 'Add a maker or label to the catalogue.'}
                </CardDescription>
              </div>
              {form.id ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  aria-label="Cancel editing"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <FormField
                  id="brand-name"
                  label="Name"
                  value={form.name}
                  onChange={updateField('name')}
                  required
                  maxLength={120}
                  placeholder="e.g. Kigali Craft Co."
                />

                <div>
                  <label htmlFor="brand-description" className={labelClasses}>
                    Description
                  </label>
                  <textarea
                    id="brand-description"
                    value={form.description}
                    onChange={updateField('description')}
                    rows={3}
                    maxLength={500}
                    className={cn(controlClasses, 'mt-1.5 resize-y')}
                    placeholder="Optional context about this brand."
                  />
                </div>

                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : form.id ? (
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {saving ? 'Saving…' : form.id ? 'Save brand' : 'Create brand'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
