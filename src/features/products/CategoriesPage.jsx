import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Plus,
  Tags,
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
import { SelectField } from '../../components/ui/SelectField';
import { controlClasses, labelClasses } from '../../components/ui/formStyles';
import { useAuth } from '../auth/authContext';
import {
  deleteCategory,
  listCategories,
  saveCategory,
  toCatalogueServiceError,
} from '../../services/catalogueService';
import { cn } from '../../utils/cn';
import {
  canManageTaxonomy,
  flattenCategories,
  getCategoryOptions,
} from './catalogueUtils';

const EMPTY_FORM = {
  id: null,
  name: '',
  description: '',
  parentId: '',
  sortOrder: '0',
};

export default function CategoriesPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = canManageTaxonomy(activeMembership?.role);

  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    const rows = await listCategories(businessId);
    setCategories(rows);
  };

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    listCategories(businessId)
      .then((rows) => {
        if (!active) return;
        setCategories(rows);
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

  const resetForm = () => {
    setForm(EMPTY_FORM);
  };

  const startEdit = (category) => {
    setForm({
      id: category.id,
      name: category.name,
      description: category.description ?? '',
      parentId: category.parentId ?? '',
      sortOrder: String(category.sortOrder ?? 0),
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManage || saving) return;

    if (!form.name.trim()) {
      setError('Enter a category name.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await saveCategory({
        id: form.id,
        businessId,
        name: form.name,
        description: form.description,
        parentId: form.parentId,
        sortOrder: form.sortOrder,
      });
      await load();
      setSuccess(form.id ? 'Category updated.' : 'Category created.');
      resetForm();
    } catch (saveError) {
      setError(toCatalogueServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category) => {
    if (
      !window.confirm(
        `Delete the category "${category.name}"? Products must be moved first.`,
      )
    ) {
      return;
    }

    setDeletingId(category.id);
    setError('');
    setSuccess('');

    try {
      await deleteCategory({ id: category.id, businessId });
      await load();
      if (form.id === category.id) resetForm();
      setSuccess('Category deleted.');
    } catch (deleteError) {
      setError(toCatalogueServiceError(deleteError).message);
    } finally {
      setDeletingId(null);
    }
  };

  const rows = flattenCategories(categories);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <section className="space-y-6" aria-labelledby="categories-title">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to catalogue
        </Link>
        <h2
          id="categories-title"
          className="mt-2 text-lg font-semibold tracking-tight text-slate-900"
        >
          Categories
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          Group products into a simple hierarchy. Categories are shared across this
          workspace.
        </p>
      </div>

      {!canManage ? (
        <Alert variant="info">
          Your role can view categories. A manager, admin or owner can create and
          change them.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading categories…
            </div>
          ) : null}

          {!loading && rows.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="No categories yet"
              description={
                canManage
                  ? 'Create your first category using the form.'
                  : 'A manager or admin can create the first category.'
              }
            />
          ) : null}

          {rows.map((category) => {
            const parent = category.parentId
              ? categoryById.get(category.parentId)
              : null;
            const isDeleting = deletingId === category.id;

            return (
              <div
                key={category.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div
                  className="min-w-0"
                  style={{ paddingLeft: `${category.depth * 20}px` }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {category.name}
                    </p>
                    <Badge variant="neutral">
                      {category.productCount} product
                      {category.productCount === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  {parent ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Under {parent.name}
                    </p>
                  ) : null}
                  {category.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {category.description}
                    </p>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(category)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(category)}
                      disabled={isDeleting || category.productCount > 0}
                      title={
                        category.productCount > 0
                          ? 'Move products out of this category first.'
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
                  {form.id ? 'Edit category' : 'New category'}
                </CardTitle>
                <CardDescription>
                  {form.id
                    ? 'Update the category details below.'
                    : 'Add a category to organise the catalogue.'}
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
                  id="category-name"
                  label="Name"
                  value={form.name}
                  onChange={updateField('name')}
                  required
                  maxLength={120}
                  placeholder="e.g. Home and living"
                />

                <div>
                  <label htmlFor="category-description" className={labelClasses}>
                    Description
                  </label>
                  <textarea
                    id="category-description"
                    value={form.description}
                    onChange={updateField('description')}
                    rows={3}
                    maxLength={500}
                    className={cn(controlClasses, 'mt-1.5 resize-y')}
                    placeholder="Optional context for this category."
                  />
                </div>

                <SelectField
                  id="category-parent"
                  label="Parent category"
                  value={form.parentId}
                  onChange={updateField('parentId')}
                  options={getCategoryOptions(categories, form.id)}
                  placeholder="Top-level category"
                />

                <FormField
                  id="category-sort-order"
                  label="Sort order"
                  type="number"
                  value={form.sortOrder}
                  onChange={updateField('sortOrder')}
                  hint="Lower numbers appear first."
                />

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
                  {saving
                    ? 'Saving…'
                    : form.id
                      ? 'Save category'
                      : 'Create category'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
