import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '../../../utils/format';

export default function StoreProductCard({ product, storeSlug }) {
  return (
    <Link
      to={`/store/${storeSlug}/products/${product.id}`}
      className="group sf-surface flex h-full flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.imageAlt || product.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
            No image available
          </div>
        )}
        {product.categoryName ? (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
            {product.categoryName}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
            {product.name}
          </h3>
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              product.availability === 'out_of_stock' ? 'bg-red-400' : 'bg-emerald-400'
            }`}
            aria-hidden="true"
          />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
          {product.description || 'View product details and availability.'}
        </p>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-900">
              {product.priceFrom ? 'From ' : ''}
              {formatCurrency(product.price, { currency: product.currency })}
            </p>
            {product.hasVariants ? (
              <p className="mt-0.5 text-[11px] text-slate-500">Multiple options available</p>
            ) : null}
          </div>
          <span className="sf-accent-text flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 transition group-hover:bg-white group-hover:shadow-sm">
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
