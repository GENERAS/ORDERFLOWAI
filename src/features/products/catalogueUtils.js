import {
  BUSINESS_ROLES,
  PRODUCT_ATTRIBUTE_TYPES,
  PRODUCT_STATUS,
  VARIANT_STATUS,
} from '../../types';

export const PRODUCT_STATUS_OPTIONS = Object.freeze([
  { value: PRODUCT_STATUS.DRAFT, label: 'Draft' },
  { value: PRODUCT_STATUS.ACTIVE, label: 'Active' },
  { value: PRODUCT_STATUS.ARCHIVED, label: 'Archived' },
]);

export const VARIANT_STATUS_OPTIONS = Object.freeze([
  { value: VARIANT_STATUS.ACTIVE, label: 'Active' },
  { value: VARIANT_STATUS.INACTIVE, label: 'Inactive' },
]);

export const ATTRIBUTE_TYPE_OPTIONS = Object.freeze([
  { value: PRODUCT_ATTRIBUTE_TYPES.TEXT, label: 'Text' },
  { value: PRODUCT_ATTRIBUTE_TYPES.NUMBER, label: 'Number' },
  { value: PRODUCT_ATTRIBUTE_TYPES.BOOLEAN, label: 'Yes / No' },
  { value: PRODUCT_ATTRIBUTE_TYPES.SELECT, label: 'Select from options' },
]);

export const TAXONOMY_ROLES = Object.freeze([
  BUSINESS_ROLES.OWNER,
  BUSINESS_ROLES.ADMIN,
  BUSINESS_ROLES.MANAGER,
]);

const STATUS_BADGES = Object.freeze({
  active: { label: 'Active', variant: 'success' },
  draft: { label: 'Draft', variant: 'warning' },
  archived: { label: 'Archived', variant: 'neutral' },
  inactive: { label: 'Inactive', variant: 'neutral' },
});

export function getStatusBadge(status) {
  return STATUS_BADGES[status] ?? { label: status, variant: 'neutral' };
}

export function canManageTaxonomy(role) {
  return TAXONOMY_ROLES.includes(role);
}

export function getCategoryOptions(categories, excludeId = null) {
  const byParent = new Map();
  for (const category of categories) {
    if (category.id === excludeId) continue;
    const key = category.parentId ?? 'root';
    const list = byParent.get(key) ?? [];
    list.push(category);
    byParent.set(key, list);
  }

  const options = [];
  const visited = new Set();

  function walk(parentId, depth) {
    const children = byParent.get(parentId) ?? [];
    for (const category of children) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      options.push({
        value: category.id,
        label: `${'— '.repeat(depth)}${category.name}`,
      });
      walk(category.id, depth + 1);
    }
  }

  walk('root', 0);

  for (const category of categories) {
    if (category.id === excludeId || visited.has(category.id)) continue;
    options.push({ value: category.id, label: category.name });
  }

  return options;
}

export function flattenCategories(categories) {
  const byParent = new Map();
  for (const category of categories) {
    const key = category.parentId ?? 'root';
    const list = byParent.get(key) ?? [];
    list.push(category);
    byParent.set(key, list);
  }

  const result = [];
  const visited = new Set();

  function walk(parentId, depth) {
    const children = byParent.get(parentId) ?? [];
    for (const category of children) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      result.push({ ...category, depth });
      walk(category.id, depth + 1);
    }
  }

  walk('root', 0);

  for (const category of categories) {
    if (visited.has(category.id)) continue;
    result.push({ ...category, depth: 0 });
  }

  return result;
}

export function getAttributeValueLabel(attribute, value) {
  if (!attribute || !value) return '';
  if (attribute.dataType === PRODUCT_ATTRIBUTE_TYPES.SELECT) {
    return (
      attribute.options.find((option) => option.id === value.optionId)?.value ??
      ''
    );
  }
  if (attribute.dataType === PRODUCT_ATTRIBUTE_TYPES.NUMBER) {
    return value.valueNumber == null
      ? ''
      : `${value.valueNumber}${attribute.unit ? ` ${attribute.unit}` : ''}`;
  }
  if (attribute.dataType === PRODUCT_ATTRIBUTE_TYPES.BOOLEAN) {
    if (value.valueBoolean == null) return '';
    return value.valueBoolean ? 'Yes' : 'No';
  }
  return value.valueText ?? '';
}

export function createEmptyVariant(attributes = []) {
  return {
    id: null,
    name: '',
    sku: '',
    barcode: '',
    priceOverride: '',
    status: VARIANT_STATUS.ACTIVE,
    attributes: Object.fromEntries(
      attributes.map((attribute) => [attribute.id, {}]),
    ),
  };
}

export function variantValuesFromRows(values, variants) {
  const result = new Map();
  for (const variant of variants) result.set(variant.id, {});
  for (const value of values) {
    if (!value.variantId) continue;
    const attributeValues = result.get(value.variantId) ?? {};
    attributeValues[value.attributeId] = {
      optionId: value.optionId ?? '',
      valueText: value.valueText ?? '',
      valueNumber: value.valueNumber ?? '',
      valueBoolean: value.valueBoolean == null ? '' : value.valueBoolean,
    };
    result.set(value.variantId, attributeValues);
  }
  return result;
}

export function productValuesFromRows(values) {
  const result = {};
  for (const value of values) {
    if (value.variantId) continue;
    result[value.attributeId] = {
      optionId: value.optionId ?? '',
      valueText: value.valueText ?? '',
      valueNumber: value.valueNumber ?? '',
      valueBoolean: value.valueBoolean == null ? '' : value.valueBoolean,
    };
  }
  return result;
}
