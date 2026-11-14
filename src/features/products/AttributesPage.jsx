import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
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
  createAttribute,
  deleteAttribute,
  listAttributes,
  toCatalogueServiceError,
  updateAttribute,
} from '../../services/catalogueService';
import { cn } from '../../utils/cn';
import { ATTRIBUTE_TYPE_OPTIONS, canManageTaxonomy } from './catalogueUtils';

const EMPTY_FORM = {
  id: null,
  name: '',
  dataType: 'text',
  isVariantAttribute: false,
  isRequired: false,
  unit: '',
  options: '',
};

function attributeTypeLabel(dataType) {
  return (
    ATTRIBUTE_TYPE_OPTIONS.find((option) => option.value === dataType)?.label ??
    dataType
  );
}

function parseOptions(value) {
  const unique = new Set();
  for (const item of String(value ?? '').split(/[\n,]/)) {
    const normalized = item.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export default function AttributesPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = canManageTaxonomy(activeMembership?.role);

  const [attributes, setAttributes] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setAttributes(await listAttributes(businessId));
  };

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    listAttributes(businessId)
      .then((rows) => {
        if (!active) return;
        setAttributes(rows);
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

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
    setSuccess('');
  };

  const resetForm = () => setForm(EMPTY_FORM);

  const startEdit = (attribute) => {
    setForm({
      id: attribute.id,
      name: attribute.name,
      dataType: attribute.dataType,
      isVariantAttribute: attribute.isVariantAttribute,
      isRequired: attribute.isRequired,
      unit: attribute.unit ?? '',
      options: attribute.options.map((option) => option.value).join('\n'),
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManage || saving) return;

    if (!form.name.trim()) {
      setError('Enter an attribute name.');
      return;
    }

    const optionValues = parseOptions(form.options);
    if (!form.id && form.dataType === 'select' && optionValues.length === 0) {
      setError('Add at least one option for a select attribute.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      if (form.id) {
        await updateAttribute({
          id: form.id,
          businessId,
          name: form.name,
          unit: form.unit,
          isRequired: form.isRequired,
        });
      } else {
        await createAttribute({
          businessId,
          name: form.name,
          dataType: form.dataType,
          isVariantAttribute: form.isVariantAttribute,
          unit: form.unit,
          options: form.dataType === 'select' ? optionValues : [],
        });
      }

      await load();
      setSuccess(form.id ? 'Attribute updated.' : 'Attribute created.');
      resetForm();
    } catch (saveError) {
      setError(toCatalogueServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (attribute) => {
    if (
      !window.confirm(
        `Delete the attribute "${attribute.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(attribute.id);
    setError('');
    setSuccess('');

    try {
      await deleteAttribute({ id: attribute.id, businessId });
      await load();
      if (form.id === attribute.id) resetForm();
      setSuccess('Attribute deleted.');
    } catch (deleteError) {
      setError(toCatalogueServiceError(deleteError).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="attributes-title">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to catalogue
        </Link>
        <h2
          id="attributes-title"
          className="mt-2 text-lg font-semibold tracking-tight text-slate-900"
        >
          Product attributes
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          Reusable details such as material, colour or capacity. Mark an attribute as a
          variant attribute to use it per size or colour.
        </p>
      </div>

      {!canManage ? (
        <Alert variant="info">
          Your role can view attributes. A manager, admin or owner can create and change
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
              Loading attributes…
            </div>
          ) : null}

          {!loading && attributes.length === 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No attributes yet"
              description={
                canManage
                  ? 'Create your first reusable attribute using the form.'
                  : 'A manager or admin can create the first attribute.'
              }
            />
          ) : null}

          {attributes.map((attribute) => {
            const isDeleting = deletingId === attribute.id;
            return (
              <div
                key={attribute.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {attribute.name}
                      </p>
                      <Badge variant="brand">
                        {attributeTypeLabel(attribute.dataType)}
                      </Badge>
                      {attribute.isVariantAttribute ? (
                        <Badge variant="neutral">Per variant</Badge>
                      ) : null}
                      {attribute.isRequired ? (
                        <Badge variant="warning">Required</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Used {attribute.usageCount} time
                      {attribute.usageCount === 1 ? '' : 's'}
                      {attribute.unit ? ` · Measured in ${attribute.unit}` : ''}
                    </p>

                    {attribute.options.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {attribute.options.map((option) => (
                          <Badge key={option.id} variant="neutral">
                            {option.value}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(attribute)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(attribute)}
                        disabled={isDeleting || attribute.usageCount > 0}
                        title={
                          attribute.usageCount > 0
                            ? 'Remove this attribute from products before deleting it.'
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
              </div>
            );
          })}
        </div>

        {canManage ? (
          <Card className="h-fit">
            <CardHeader>
              <div>
                <CardTitle as="h3">
                  {form.id ? 'Edit attribute' : 'New attribute'}
                </CardTitle>
                <CardDescription>
                  {form.id
                    ? 'Update the name, unit and required setting.'
                    : 'Add a reusable detail products can capture.'}
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
                  id="attribute-name"
                  label="Name"
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. Material"
                />

                {form.id ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-500">
                    Data type and options cannot be changed after creation. Current type:{' '}
                    <span className="font-semibold text-slate-700">
                      {attributeTypeLabel(form.dataType)}
                    </span>
                    .
                  </div>
                ) : (
                  <>
                    <SelectField
                      id="attribute-data-type"
                      label="Data type"
                      value={form.dataType}
                      onChange={(event) =>
                        updateField('dataType', event.target.value)
                      }
                      options={ATTRIBUTE_TYPE_OPTIONS}
                    />

                    <label className="flex items-start gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.isVariantAttribute}
                        onChange={(event) =>
                          updateField(
                            'isVariantAttribute',
                            event.target.checked,
                          )
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span>
                        Per variant
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Capture this value separately for each variant.
                        </span>
                      </span>
                    </label>

                    {form.dataType === 'select' ? (
                      <div>
                        <label
                          htmlFor="attribute-options"
                          className={labelClasses}
                        >
                          Options
                        </label>
                        <textarea
                          id="attribute-options"
                          value={form.options}
                          onChange={(event) =>
                            updateField('options', event.target.value)
                          }
                          rows={4}
                          className={cn(controlClasses, 'mt-1.5 resize-y')}
                          placeholder={'Small\nMedium\nLarge'}
                        />
                        <p className="mt-1.5 text-xs text-slate-500">
                          One option per line, or separate with commas.
                        </p>
                      </div>
                    ) : null}
                  </>
                )}

                <FormField
                  id="attribute-unit"
                  label="Unit"
                  value={form.unit}
                  onChange={(event) => updateField('unit', event.target.value)}
                  maxLength={40}
                  placeholder="e.g. cm, kg, ml"
                  hint="Optional. Useful for number attributes."
                />

                <label className="flex items-start gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isRequired}
                    onChange={(event) =>
                      updateField('isRequired', event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    Required
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Products must supply a value for this attribute.
                    </span>
                  </span>
                </label>

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
                      ? 'Save attribute'
                      : 'Create attribute'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
