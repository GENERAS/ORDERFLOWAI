import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { formatCurrency } from '../../../utils/format';
import {
  getAvailabilityLabel,
  getAvailabilityVariant,
} from '../storefrontUtils';

export default function StoreProductCard({ product, storeSlug }) {
  return (
    <Link
      to={`/store/${storeSlug}/products/${product.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-square overflow-hidden bg-slate-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.imageAlt || product.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
            No image available
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {product.categoryName ? (
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {product.categoryName}
              </p>
            ) : null}
            <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-slate-900">
              {product.name}
            </h3>
          </div>
          <Badge variant={getAvailabilityVariant(product.availability)}>
            {getAvailabilityLabel(product.availability)}
          </Badge>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-slate-500">
          {product.description || 'View product details and availability.'}
        </p>
        <div className="mt-auto pt-4">
          <p className="text-lg font-semibold text-slate-900">
            {product.priceFrom ? 'From ' : ''}
            {formatCurrency(product.price, { currency: product.currency })}
          </p>
          {product.hasVariants ? (
            <p className="mt-0.5 text-xs text-slate-500">Multiple options available</p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
