/**
 * Shared domain constants and JSDoc types for OrderFlow AI.
 * Day 2 defines the multi-tenant business, profile and membership contracts.
 */

export const BUSINESS_ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff',
});

export const BUSINESS_MEMBER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INVITED: 'invited',
  SUSPENDED: 'suspended',
});

export const PRODUCT_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
});

export const VARIANT_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

export const PRODUCT_ATTRIBUTE_TYPES = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  SELECT: 'select',
});

export const INVENTORY_STATUS = Object.freeze({
  TRACKED: 'tracked',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
  UNTRACKED: 'untracked',
});

export const STOCK_OPERATION = Object.freeze({
  RECEIVE: 'receive',
  REDUCE: 'reduce',
  ADJUSTMENT: 'adjustment',
  DAMAGE: 'damage',
  LOSS: 'loss',
  RETURN: 'return',
  RESERVE: 'reserve',
  RELEASE: 'release',
});

export const ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'unpaid',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
});

/**
 * @typedef {'owner'|'admin'|'manager'|'staff'} BusinessRole
 */

/**
 * @typedef {'active'|'invited'|'suspended'} BusinessMemberStatus
 */

/**
 * @typedef {Object} Business
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {string} [industry]
 * @property {string} country
 * @property {string} currency
 * @property {string} timezone
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} [fullName]
 * @property {string} [avatarUrl]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} BusinessMember
 * @property {string} id
 * @property {string} businessId
 * @property {string} userId
 * @property {BusinessRole} role
 * @property {BusinessMemberStatus} status
 * @property {string} createdAt
 */

/**
 * @typedef {'draft'|'active'|'archived'} ProductStatus
 */

/**
 * @typedef {'active'|'inactive'} VariantStatus
 */

/**
 * @typedef {'text'|'number'|'boolean'|'select'} ProductAttributeType
 */

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} businessId
 * @property {string} name
 * @property {string} [description]
 * @property {string} [sku]
 * @property {string} [barcode]
 * @property {number} price
 * @property {string} currency
 * @property {ProductStatus} status
 * @property {string} [categoryId]
 * @property {string} [brandId]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} ProductVariant
 * @property {string} id
 * @property {string} productId
 * @property {string} name
 * @property {string} [sku]
 * @property {string} [barcode]
 * @property {number} [priceOverride]
 * @property {VariantStatus} status
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} businessId
 * @property {string} name
 * @property {string} [description]
 * @property {string} [parentId]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} Brand
 * @property {string} id
 * @property {string} businessId
 * @property {string} name
 * @property {string} [description]
 */

/**
 * @typedef {Object} ProductAttribute
 * @property {string} id
 * @property {string} businessId
 * @property {string} name
 * @property {ProductAttributeType} dataType
 * @property {boolean} variantLevel
 * @property {boolean} required
 * @property {string} [unit]
 */

/**
 * @typedef {Object} ProductImage
 * @property {string} id
 * @property {string} productId
 * @property {string} storagePath
 * @property {string} [altText]
 * @property {boolean} isPrimary
 * @property {number} sortOrder
 */

/**
 * @typedef {'tracked'|'low_stock'|'out_of_stock'|'untracked'} InventoryStatus
 */

/**
 * @typedef {'receive'|'reduce'|'adjustment'|'damage'|'loss'|'return'|'reserve'|'release'} StockOperation
 */

/**
 * @typedef {Object} InventoryItem
 * @property {string|null} inventoryItemId
 * @property {string} businessId
 * @property {string} productId
 * @property {string|null} variantId
 * @property {string} productName
 * @property {string|null} variantName
 * @property {string|null} sku
 * @property {number} physicalQuantity
 * @property {number} reservedQuantity
 * @property {number} availableQuantity
 * @property {number|null} lowStockThreshold
 * @property {InventoryStatus} inventoryStatus
 */

/**
 * @typedef {Object} StockMovement
 * @property {string} id
 * @property {string} inventoryItemId
 * @property {string} productName
 * @property {string|null} variantName
 * @property {StockOperation} operation
 * @property {number} quantityChange
 * @property {number} previousPhysical
 * @property {number} newPhysical
 * @property {number} previousReserved
 * @property {number} newReserved
 * @property {string|null} reason
 * @property {string} performedByName
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} businessId
 * @property {string} [customerId]
 * @property {string} status
 * @property {string} paymentStatus
 * @property {number} total
 * @property {string} [currency]
 */
