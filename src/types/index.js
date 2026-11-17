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
  AWAITING_BUSINESS_APPROVAL: 'awaiting_business_approval',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
});

export const PAYMENT_RECORD_STATUS = Object.freeze({
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  FAILED: 'failed',
});

export const PAYMENT_REFUND_STATUS = Object.freeze({
  REQUESTED: 'requested',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
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
 * @typedef {Object} CustomerAddress
 * @property {string} id
 * @property {string} businessId
 * @property {string} customerId
 * @property {string|null} label
 * @property {string|null} recipientName
 * @property {string} line1
 * @property {string|null} line2
 * @property {string|null} city
 * @property {string|null} region
 * @property {string|null} postalCode
 * @property {string} country
 * @property {boolean} isDefault
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} CustomerPrimaryAddress
 * @property {string|null} label
 * @property {string} line1
 * @property {string|null} city
 * @property {string|null} country
 */

/**
 * @typedef {'active'|'inactive'|'archived'} CustomerStatus
 */

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} businessId
 * @property {string} fullName
 * @property {string|null} companyName
 * @property {string|null} email
 * @property {string|null} phone
 * @property {string|null} notes
 * @property {CustomerStatus} status
 * @property {string[]} tags
 * @property {number} addressCount
 * @property {CustomerPrimaryAddress|null} primaryAddress
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} totalCount
 */

/**
 * @typedef {Object} CustomerNote
 * @property {string} id
 * @property {string} businessId
 * @property {string} customerId
 * @property {string} body
 * @property {string} authorName
 * @property {string|null} createdBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CustomerEvent
 * @property {string} id
 * @property {string} businessId
 * @property {string} customerId
 * @property {string} eventType
 * @property {string} description
 * @property {string|null} actorId
 * @property {string} actorName
 * @property {string} createdAt
 */

/**
 * @typedef {'draft'|'awaiting_confirmation'|'awaiting_business_approval'|'confirmed'|'processing'|'ready'|'completed'|'cancelled'} OrderStatus
 */

/**
 * @typedef {'none'|'reserved'|'released'|'consumed'} OrderStockState
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} businessId
 * @property {string} orderNumber
 * @property {string|null} customerId
 * @property {boolean} isGuest
 * @property {string} customerName
 * @property {string|null} customerPhone
 * @property {string|null} customerEmail
 * @property {OrderStatus} status
 * @property {OrderStockState} stockState
 * @property {string} currency
 * @property {number} subtotal
 * @property {number} total
 * @property {string|null} notes
 * @property {string|null} cancellationReason
 * @property {number} itemCount
 * @property {string|null} confirmedAt
 * @property {string|null} completedAt
 * @property {string|null} cancelledAt
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} totalCount
 */

/**
 * @typedef {Object} OrderItem
 * @property {string} id
 * @property {string} businessId
 * @property {string} orderId
 * @property {string} productId
 * @property {string|null} variantId
 * @property {string} productName
 * @property {string|null} variantName
 * @property {string|null} sku
 * @property {number} unitPrice
 * @property {number} quantity
 * @property {number} reservedQuantity
 * @property {number} lineTotal
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} OrderEvent
 * @property {string} id
 * @property {string} businessId
 * @property {string} orderId
 * @property {'created'|'updated'|'status_changed'|'customer_confirmed'|'business_approved'|'stock_reserved'|'stock_released'|'stock_consumed'|'fulfilled'|'cancelled'} eventType
 * @property {string} summary
 * @property {Object} details
 * @property {string|null} actorId
 * @property {string} actorName
 * @property {string} createdAt
 */

/**
 * @typedef {'pending'|'partially_paid'|'paid'|'failed'|'refunded'|'partially_refunded'} PaymentStatus
 */

/**
 * @typedef {'pending'|'verified'|'rejected'|'failed'} PaymentRecordStatus
 */

/**
 * @typedef {'requested'|'completed'|'rejected'} PaymentRefundStatus
 */

/**
 * @typedef {Object} PaymentMethod
 * @property {string} id
 * @property {string} code
 * @property {string} label
 * @property {boolean} isActive
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} Payment
 * @property {string} id
 * @property {string} businessId
 * @property {string} orderId
 * @property {string} paymentNumber
 * @property {string} orderNumber
 * @property {string} customerName
 * @property {OrderStatus} orderStatus
 * @property {number} orderTotal
 * @property {number} amount
 * @property {string} currency
 * @property {string} methodCode
 * @property {string} methodLabel
 * @property {PaymentRecordStatus} status
 * @property {string} paymentDate
 * @property {string|null} transactionReference
 * @property {string|null} providerKey
 * @property {string|null} providerTransactionId
 * @property {string|null} providerEventId
 * @property {string|null} notes
 * @property {string} recordedByName
 * @property {string|null} verifiedByName
 * @property {string|null} verifiedAt
 * @property {string|null} verificationNote
 * @property {string|null} rejectedByName
 * @property {string|null} rejectedAt
 * @property {string|null} rejectionReason
 * @property {string|null} failedAt
 * @property {string|null} failureReason
 * @property {number} refundedAmount
 * @property {number} requestedRefundAmount
 * @property {number} refundableAmount
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} totalCount
 */

/**
 * @typedef {Object} PaymentRefund
 * @property {string} id
 * @property {string} businessId
 * @property {string} paymentId
 * @property {number} amount
 * @property {PaymentRefundStatus} status
 * @property {string} reason
 * @property {string|null} reference
 * @property {string} requestedByName
 * @property {string} requestedAt
 * @property {string|null} completedByName
 * @property {string|null} completedAt
 * @property {string|null} rejectedByName
 * @property {string|null} rejectedAt
 * @property {string|null} rejectionReason
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} PaymentEvent
 * @property {string} id
 * @property {string} businessId
 * @property {string} paymentId
 * @property {'created'|'verified'|'rejected'|'failed'|'refund_requested'|'refund_completed'|'refund_rejected'} eventType
 * @property {string} summary
 * @property {Object} details
 * @property {string} actorName
 * @property {string} createdAt
 */

/**
 * @typedef {Object} OrderPaymentSummary
 * @property {string|null} orderId
 * @property {string|null} orderNumber
 * @property {string} currency
 * @property {number} orderTotal
 * @property {number} verifiedAmount
 * @property {number} refundedAmount
 * @property {number} netPaid
 * @property {number} balanceDue
 * @property {number} pendingAmount
 * @property {number} pendingCount
 * @property {number} failedAmount
 * @property {number} requestedRefundAmount
 * @property {PaymentStatus} paymentStatus
 * @property {number} paymentCount
 * @property {string|null} lastPaymentAt
 */
