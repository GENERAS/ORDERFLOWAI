export const CUSTOMER_PAGE_SIZE = 12;

export const CUSTOMER_SORT_OPTIONS = Object.freeze([
  { value: 'name', label: 'Customer name' },
  { value: 'company', label: 'Company' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'created', label: 'Recently added' },
]);

export const CUSTOMER_STATUS_OPTIONS = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
]);

export const CUSTOMER_STATUS_META = Object.freeze({
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'warning' },
  archived: { label: 'Archived', variant: 'neutral' },
});

export const DUPLICATE_REASON_LABELS = Object.freeze({
  email: 'Email matches',
  phone: 'Phone matches',
  name: 'Name matches',
});

export const CUSTOMER_EVENT_LABELS = Object.freeze({
  customer_created: 'Created',
  customer_updated: 'Profile updated',
  status_changed: 'Status',
  tags_updated: 'Tags',
  note_added: 'Note',
  address_added: 'Address added',
  address_updated: 'Address updated',
  address_deleted: 'Address removed',
  duplicate_override: 'Duplicate override',
});

export const EMPTY_CUSTOMER_FORM = Object.freeze({
  fullName: '',
  companyName: '',
  email: '',
  phone: '',
  notes: '',
  status: 'active',
  tags: '',
});

export const EMPTY_ADDRESS_FORM = Object.freeze({
  label: '',
  recipientName: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  isDefault: false,
});

export function canManageCustomers(role) {
  return ['owner', 'admin', 'manager', 'staff'].includes(role);
}

export function canOverrideCustomerDuplicates(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}

export function getCustomerStatusMeta(status) {
  return CUSTOMER_STATUS_META[status] ?? CUSTOMER_STATUS_META.active;
}

export function parseCustomerTags(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => {
      if (!tag || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

export function formatCustomerTagsInput(tags) {
  return (tags ?? []).join(', ');
}

export function getCustomerInitials(fullName) {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatCustomerAddress(address) {
  if (!address) return [];
  return [
    address.line1,
    address.line2,
    [address.city, address.region, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
}

export function customerValuesFromRecord(customer) {
  if (!customer) return { ...EMPTY_CUSTOMER_FORM };
  return {
    fullName: customer.fullName ?? '',
    companyName: customer.companyName ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    notes: customer.notes ?? '',
    status: customer.status ?? 'active',
    tags: formatCustomerTagsInput(customer.tags),
  };
}

export function addressValuesFromRecord(address) {
  if (!address) return { ...EMPTY_ADDRESS_FORM };
  return {
    label: address.label ?? '',
    recipientName: address.recipientName ?? '',
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    region: address.region ?? '',
    postalCode: address.postalCode ?? '',
    country: address.country ?? '',
    isDefault: Boolean(address.isDefault),
  };
}
