import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { controlClasses, labelClasses } from '../../components/ui/formStyles';
import { useAuth } from '../auth/authContext';
import {
  createProduct,
  getProduct,
  loadCatalogueMeta,
  toCatalogueServiceError,
  updateProduct,
} from '../../services/catalogueService';
import { cn } from '../../utils/cn';
import { formatCurrency } from '../../utils/format';
import {
  canManageTaxonomy,
  createEmptyVariant,
  getCategoryOptions,
  getStatusBadge,
  PRODUCT_STATUS_OPTIONS,
  productValuesFromRows,
  VARIANT_STATUS_OPTIONS,
  variantValuesFromRows,
} from './catalogueUtils';
import { ProductImageManager } from './components/ProductImageManager';

const EMPTY_FORM = Object.freeze({
  name: '',
  description: '',
  categoryId: '',
  brandId: '',
  sku: '',
  barcode: '',
  price: '0',
  status: 'draft',
});

function AttributeFields({ attributes, values, onChange, prefix }) {
  if (attributes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
        No attributes configured for this level yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {attributes.map((attribute) => {
        const current = values?.[attribute.id] ?? {};
        const inputId = `${prefix}-${attribute.id}`;
        const setValue = (field, value) =>
          onChange(attribute.id, { ...current, [field]: value });

        if (attribute.dataType === 'select') {
          return (
            <SelectField
              key={attribute.id}
              id={inputId}
              label={attribute.name}
              value={current.optionId ?? ''}
              onChange={(event) => setValue('optionId', event.target.value)}
              options={attribute.options.map((option) => ({
                value: option.id,
                label: option.value,
              }))}
              placeholder="Select an option"
              required={attribute.isRequired}
            />
          );
        }

        if (attribute.dataType === 'boolean') {
          return (
            <SelectField
              key={attribute.id}
              id={inputId}
              label={attribute.name}
              value={
                current.valueBoolean === '' || current.valueBoolean == null
                  ? ''
                  : String(current.valueBoolean)
              }
              onChange={(event) => setValue('valueBoolean', event.target.value)}
              options={[
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ]}
              placeholder="Not set"
              required={attribute.isRequired}
            />
          );
        }

        return (
          <FormField
            key={attribute.id}
            id={inputId}
            label={attribute.name}
            type={attribute.dataType === 'number' ? 'number' : 'text'}
            step={attribute.dataType === 'number' ? 'any' : undefined}
            value={
              attribute.dataType === 'number'
                ? current.valueNumber ?? ''
                : current.valueText ?? ''
            }
            onChange={(event) =>
              setValue(
                attribute.dataType === 'number' ? 'valueNumber' : 'valueText',
                event.target.value,
              )
            }
            hint={attribute.unit ? `Measured in ${attribute.unit}` : undefined}
            required={attribute.isRequired}
          />
        );
      })}
    </div>
  );
}

export default function ProductEditorPage() {
  const { productId } = useParams();
  const isNew = !productId;
  const navigate = useNavigate();
  const location = useLocation();
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = canManageTaxonomy(activeMembership?.role);

  const [meta, setMeta] = useState({
    categories: [],
    brands: [],
    attributes: [],
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [attributeValues, setAttributeValues] = useState({});
  const [variants, setVariants] = useState([]);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [justCreated, setJustCreated] = useState(() =>
    Boolean(location.state?.created),
  );
  const [errors, setErrors] = useState({});

  const productAttributes = useMemo(
    () => meta.attributes.filter((attribute) => !attribute.isVariantAttribute),
    [meta.attributes],
  );
  const variantAttributes = useMemo(
    () => meta.attributes.filter((attribute) => attribute.isVariantAttribute),
    [meta.attributes],
  );

  const applyProduct = (loadedProduct) => {
    setProduct(loadedProduct);
    setForm({
      name: loadedProduct.name ?? '',
      description: loadedProduct.description ?? '',
      categoryId: loadedProduct.categoryId ?? '',
      brandId: loadedProduct.brandId ?? '',
      sku: loadedProduct.sku ?? '',
      barcode: loadedProduct.barcode ?? '',
      price: String(loadedProduct.price ?? 0),
      status: loadedProduct.status ?? 'draft',
    });
    setAttributeValues(productValuesFromRows(loadedProduct.attributeValues));
    const valuesByVariant = variantValuesFromRows(
      loadedProduct.attributeValues,
      loadedProduct.variants,
    );
    setVariants(
      loadedProduct.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku ?? '',
        barcode: variant.barcode ?? '',
        priceOverride:
          variant.priceOverride == null ? '' : String(variant.priceOverride),
        status: variant.status,
        attributes: valuesByVariant.get(variant.id) ?? {},
      })),
    );
  };

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    Promise.all([
      loadCatalogueMeta(businessId),
      productId ? getProduct({ businessId, productId }) : Promise.resolve(null),
    ])
      .then(([loadedMeta, loadedProduct]) => {
        if (!active) return;
        setMeta(loadedMeta);
        setError('');
        if (loadedProduct) {
          applyProduct(loadedProduct);
        } else {
          setForm(EMPTY_FORM);
          setAttributeValues({});
          setVariants([]);
          setProduct(null);
        }
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
  }, [businessId, productId]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setError('');
    setSuccess('');
    setJustCreated(false);
  };

  const setAttributeValue = (attributeId, value) => {
    setAttributeValues((current) => ({ ...current, [attributeId]: value }));
    setJustCreated(false);
  };

  const updateVariant = (index, field, value) => {
    setVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant,
      ),
    );
    setError('');
    setSuccess('');
  };

  const setVariantAttributeValue = (index, attributeId, value) => {
    setVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index
          ? {
              ...variant,
              attributes: {
                ...variant.attributes,
                [attributeId]: value,
              },
            }
          : variant,
      ),
    );
  };

  const validate = () => {
    const nextErrors = {};
    const normalizedName = form.name.trim();
    const numericPrice = Number(form.price);

    if (normalizedName.length < 1 || normalizedName.length > 200) {
      nextErrors.name = 'Enter a product name up to 200 characters.';
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      nextErrors.price = 'Enter a price of zero or more.';
    }

    for (const [index, variant] of variants.entries()) {
      if (!variant.name.trim()) {
        nextErrors.variants = `Variant ${index + 1} needs a name.`;
        break;
      }
      if (
        variant.priceOverride !== '' &&
        (!Number.isFinite(Number(variant.priceOverride)) ||
          Number(variant.priceOverride) < 0)
      ) {
        nextErrors.variants = `Variant ${index + 1} has an invalid price.`;
        break;
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    setSuccess('');

    if (!validate()) {
      setError('Fix the highlighted fields before saving.');
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name,
      description: form.description,
      categoryId: form.categoryId,
      brandId: form.brandId,
      sku: form.sku,
      barcode: form.barcode,
      price: Number(form.price),
      status: form.status,
      attributes: attributeValues,
      variants,
    };

    try {
      if (isNew) {
        const created = await createProduct({ businessId, ...payload });
        setLoading(true);
        navigate(`/products/${created.id}/edit`, {
          replace: true,
          state: { created: true },
        });
        return;
      }

      await updateProduct({ productId, ...payload });
      const refreshed = await getProduct({ businessId, productId });
      applyProduct(refreshed);
      setSuccess('Product saved.');
    } catch (saveError) {
      setError(toCatalogueServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = getStatusBadge(form.status);
  const categoryOptions = getCategoryOptions(meta.categories);
  const currency = activeBusiness?.currency ?? product?.currency ?? 'RWF';

  if (!businessId) {
    return <Alert variant="error">Select a workspace to manage products.</Alert>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading product…
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="product-editor-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to catalogue
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2
              id="product-editor-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              {isNew ? 'New product' : form.name || 'Edit product'}
            </h2>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Product details, variants and real photos are saved to this workspace only.
          </p>
        </div>

        <Button type="submit" form="product-form" size="lg" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
        </Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success || justCreated ? (
        <Alert variant="success">
          {success || 'Product created. You can add photos below.'}
        </Alert>
      ) : null}

      <form id="product-form" className="space-y-6" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Product details</CardTitle>
                  <CardDescription>
                    The customer-facing name and description for this catalogue item.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  id="product-name"
                  label="Product name"
                  value={form.name}
                  onChange={updateField('name')}
                  error={errors.name}
                  required
                  maxLength={200}
                  placeholder="e.g. Handwoven storage basket"
                />

                <div>
                  <label htmlFor="product-description" className={labelClasses}>
                    Description
                  </label>
                  <textarea
                    id="product-description"
                    value={form.description}
                    onChange={updateField('description')}
                    rows={5}
                    maxLength={5000}
                    className={cn(controlClasses, 'mt-1.5 min-h-28 resize-y')}
                    placeholder="Materials, dimensions, colours and other useful details."
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {form.description.length}/5000 characters
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Product attributes</CardTitle>
                  <CardDescription>
                    Flexible details such as material, colour or capacity.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <AttributeFields
                  attributes={productAttributes}
                  values={attributeValues}
                  onChange={setAttributeValue}
                  prefix="product-attribute"
                />
                {!canManage && productAttributes.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    A manager or admin can configure reusable attributes in the
                    Attributes page.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Variants</CardTitle>
                  <CardDescription>
                    Optional sizes, colours or other selectable options.
                  </CardDescription>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setVariants((current) => [
                      ...current,
                      createEmptyVariant(variantAttributes),
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add variant
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {variants.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    This product has no variants. It is sold as a single option.
                  </p>
                ) : null}

                {variants.map((variant, index) => (
                  <div
                    key={variant.id ?? `new-variant-${index}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">
                        Variant {index + 1}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setVariants((current) =>
                            current.filter(
                              (_, variantIndex) => variantIndex !== index,
                            ),
                          )
                        }
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        id={`variant-name-${index}`}
                        label="Variant name"
                        value={variant.name}
                        onChange={(event) =>
                          updateVariant(index, 'name', event.target.value)
                        }
                        required
                        maxLength={160}
                        placeholder="e.g. Large / Indigo"
                      />
                      <SelectField
                        id={`variant-status-${index}`}
                        label="Status"
                        value={variant.status}
                        onChange={(event) =>
                          updateVariant(index, 'status', event.target.value)
                        }
                        options={VARIANT_STATUS_OPTIONS}
                        placeholder="Select a status"
                      />
                      <FormField
                        id={`variant-sku-${index}`}
                        label="Variant SKU"
                        value={variant.sku}
                        onChange={(event) =>
                          updateVariant(index, 'sku', event.target.value)
                        }
                        maxLength={80}
                      />
                      <FormField
                        id={`variant-barcode-${index}`}
                        label="Variant barcode"
                        value={variant.barcode}
                        onChange={(event) =>
                          updateVariant(index, 'barcode', event.target.value)
                        }
                        maxLength={80}
                      />
                      <FormField
                        id={`variant-price-${index}`}
                        label={`Price override (${currency})`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={variant.priceOverride}
                        onChange={(event) =>
                          updateVariant(index, 'priceOverride', event.target.value)
                        }
                        hint="Leave blank to use the product price."
                      />
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Variant attributes
                      </p>
                      <AttributeFields
                        attributes={variantAttributes}
                        values={variant.attributes}
                        onChange={(attributeId, value) =>
                          setVariantAttributeValue(index, attributeId, value)
                        }
                        prefix={`variant-${index}-attribute`}
                      />
                    </div>
                  </div>
                ))}

                {variants.length > 0 ? (
                  <p className="text-xs leading-relaxed text-slate-500">
                    Removing a saved variant keeps its historical record but marks it
                    inactive.
                  </p>
                ) : null}
                {errors.variants ? (
                  <p className="text-xs font-medium text-red-600">
                    {errors.variants}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Organisation</CardTitle>
                  <CardDescription>
                    How this product is grouped and displayed.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <SelectField
                  id="product-status"
                  label="Status"
                  value={form.status}
                  onChange={updateField('status')}
                  options={PRODUCT_STATUS_OPTIONS}
                  placeholder="Select a status"
                />
                <SelectField
                  id="product-category"
                  label="Category"
                  value={form.categoryId}
                  onChange={updateField('categoryId')}
                  options={categoryOptions}
                  placeholder="No category"
                  hint={
                    !canManage
                      ? 'A manager or admin manages categories.'
                      : undefined
                  }
                />
                <SelectField
                  id="product-brand"
                  label="Brand"
                  value={form.brandId}
                  onChange={updateField('brandId')}
                  options={meta.brands.map((brand) => ({
                    value: brand.id,
                    label: brand.name,
                  }))}
                  placeholder="No brand"
                />
                <div className="grid gap-2 border-t border-slate-100 pt-4 text-xs">
                  <Link
                    to="/products/categories"
                    className="font-semibold text-brand-700 hover:text-brand-800"
                  >
                    Manage categories
                  </Link>
                  <Link
                    to="/products/brands"
                    className="font-semibold text-brand-700 hover:text-brand-800"
                  >
                    Manage brands
                  </Link>
                  <Link
                    to="/products/attributes"
                    className="font-semibold text-brand-700 hover:text-brand-800"
                  >
                    Manage attributes
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Pricing and codes</CardTitle>
                  <CardDescription>
                    Workspace currency: {currency}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  id="product-price"
                  label={`Base price (${currency})`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={updateField('price')}
                  error={errors.price}
                  required
                  hint={
                    Number.isFinite(Number(form.price))
                      ? formatCurrency(Number(form.price), { currency })
                      : undefined
                  }
                />
                <FormField
                  id="product-sku"
                  label="SKU"
                  value={form.sku}
                  onChange={updateField('sku')}
                  maxLength={80}
                  hint="Unique per business across products and variants."
                />
                <FormField
                  id="product-barcode"
                  label="Barcode"
                  value={form.barcode}
                  onChange={updateField('barcode')}
                  maxLength={80}
                  hint="Optional. Unique per business when supplied."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle as="h3">Catalogue guidance</CardTitle>
                  <CardDescription>
                    Useful before publishing this product.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs leading-relaxed text-slate-500">
                <p>Use clear names customers would recognise.</p>
                <p>Keep draft products hidden until the details and photos are ready.</p>
                <p>Archive products instead of deleting them to preserve history.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h3">Photos</CardTitle>
            <CardDescription>
              Real product photos stored in the private product-images bucket.
            </CardDescription>
          </div>
          {isNew ? (
            <Badge variant="neutral">
              <ImagePlus className="h-3 w-3" aria-hidden="true" />
              After saving
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {isNew ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Create the product first. You will be taken straight to its edit page to
              add photos.
            </p>
          ) : (
            <ProductImageManager
              key={productId}
              businessId={businessId}
              productId={productId}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
