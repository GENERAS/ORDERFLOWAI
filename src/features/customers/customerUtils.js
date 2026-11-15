export const CUSTOMER_PAGE_SIZE = 12;

export const CUSTOMER_SORT_OPTIONS = Object.freeze([
  { value: 'name', label: 'Customer name' },
  { value: 'company', label: 'Company' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'created', label: 'Recently added' },
]);

export const DUPLICATE_REASON_LABELS = Object.freeze({
  email: 'Email matches',
  phone: 'Phone matches',
  name: 'Name matches',
});

export const EMPTY_CUSTOMER_FORM = Object.freeze({
  fullName: '',
  companyName: '',
  email: '',
  phone: '',
  notes: '',
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
