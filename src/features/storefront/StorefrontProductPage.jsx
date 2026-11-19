import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatCurrency } from '../../utils/format';
import { useStorefront } from './StorefrontContext';
import {
  buildCheckoutUrl,
  buildWhatsAppHandoffUrl,
  getAvailabilityLabel,
  getAvailabilityVariant,
  getCartSubtotal,
} from './storefrontUtils';
import {
  createStorefrontCheckoutReference,
  getStorefrontProduct,
  toStorefrontServiceError,
} from './storefrontService';

export default function StorefrontProductPage() {
  const { storeSlug, productId } = useParams();
  const { store, addToCart } = useStorefront();
  const [product, setProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappError, setWhatsappError] = useState('');
  const [whatsappReference, setWhatsappReference] = useState(null);
  const [copied, setCopied] = useState(false);
  const whatsappBusyRef = useRef(false);

  useEffect(() => {
    let active = true;

    getStorefrontProduct({ storeSlug, productId })
      .then((data) => {
        if (!active) return;
        setProduct(data);
        const firstAvailable =
          data.variants.find((variant) => variant.inStock) ?? data.variants[0] ?? null;
        setSelectedVariantId(firstAvailable?.id ?? null);
        setActiveImage(data.images[0]?.url ?? null);
        setError('');
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(toStorefrontServiceError(loadError).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [storeSlug, productId]);

  const selectedVariant = useMemo(
    () => product?.variants.find((variant) => variant.id === selectedVariantId) ?? null,
    [product, selectedVariantId],
  );

  const unitPrice = selectedVariant?.price ?? product?.price ?? 0;
  const inStock = product
    ? product.hasVariants
      ? Boolean(selectedVariant?.inStock)
      : product.availability !== 'out_of_stock'
    : false;

  const handleAddToCart = () => {
    if (!product) return;
    addToCart({
      productId: product.id,
      variantId: selectedVariant?.id ?? null,
      name: product.name,
      variantName: selectedVariant?.name ?? '',
      imageUrl: activeImage || product.images[0]?.url || null,
      price: unitPrice,
      currency: product.currency,
      quantity,
      inStock,
      isTracked: selectedVariant ? selectedVariant.isTracked : product.availability !== 'untracked',
    });
    setQuantity(1);
  };

  const handleOrderOnWhatsApp = async () => {
    if (!product || !inStock || whatsappBusyRef.current) return;

    whatsappBusyRef.current = true;
    setWhatsappBusy(true);
    setWhatsappError('');
    setCopied(false);

    try {
      const created = await createStorefrontCheckoutReference({
        storeSlug,
        items: [{
          productId: product.id,
          variantId: selectedVariant?.id ?? null,
          quantity,
        }],
        channel: 'whatsapp',
      });
      setWhatsappReference(created);

      const handoffUrl = buildWhatsAppHandoffUrl({
        phone: store.contactPhone,
        storeName: store.name,
        checkoutPath: created.checkoutPath,
      });
      if (handoffUrl) {
        window.open(handoffUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (handoffError) {
      setWhatsappError(toStorefrontServiceError(handoffError).message);
    } finally {
      whatsappBusyRef.current = false;
      setWhatsappBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!whatsappReference) return;
    const checkoutUrl = buildCheckoutUrl(whatsappReference.checkoutPath);

    try {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
    } catch {
      setWhatsappError(`Copy this link: ${checkoutUrl}`);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading product…
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Alert variant="error" title="Product unavailable">
          {error || 'This product could not be found.'}
        </Alert>
        <Link
          to={`/store/${storeSlug}`}
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to store
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/store/${storeSlug}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Continue shopping
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {activeImage ? (
              <img
                src={activeImage}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                No image available
              </div>
            )}
          </div>
          {product.images.length > 1 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {product.images.map((image) => (
                <button
                  key={image.path}
                  type="button"
                  onClick={() => setActiveImage(image.url)}
                  className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-white ${
                    activeImage === image.url
                      ? 'border-slate-900'
                      : 'border-transparent ring-1 ring-slate-200'
                  }`}
                  aria-label={`View ${image.alt}`}
                >
                  {image.url ? (
                    <img
                      src={image.url}
                      alt={image.alt}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          {product.categoryName ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {product.categoryName}
            </p>
          ) : null}
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {product.name}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant={getAvailabilityVariant(product.availability)}>
              {getAvailabilityLabel(product.availability)}
            </Badge>
            {product.brandName ? (
              <Badge variant="neutral">{product.brandName}</Badge>
            ) : null}
          </div>

          <p className="mt-6 text-3xl font-semibold text-slate-900">
            {product.priceFrom ? 'From ' : ''}
            {formatCurrency(product.price, { currency: product.currency })}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prices are confirmed from the live catalogue when you check out.
          </p>

          {product.description ? (
            <div className="mt-7">
              <h2 className="text-sm font-semibold text-slate-900">Description</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">
                {product.description}
              </p>
            </div>
          ) : null}

          {product.variants.length > 0 ? (
            <div className="mt-7">
              <h2 className="text-sm font-semibold text-slate-900">Available options</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {product.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={!variant.inStock}
                    onClick={() => setSelectedVariantId(variant.id)}
                    className={`rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedVariantId === variant.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <span className="block text-sm font-medium">{variant.name}</span>
                    <span className="mt-0.5 block text-xs opacity-80">
                      {formatCurrency(variant.price, { currency: product.currency })}
                      {!variant.inStock ? ' · Out of stock' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="inline-flex items-center rounded-lg border border-slate-300">
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  className="p-2.5 text-slate-600 hover:text-slate-900"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="w-10 text-center text-sm font-medium">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.min(100, value + 1))}
                  className="p-2.5 text-slate-600 hover:text-slate-900"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <Button
                className="flex-1"
                disabled={!inStock}
                onClick={handleAddToCart}
                style={{ backgroundColor: inStock ? store.brandColor : undefined }}
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {inStock ? 'Add to cart' : 'Out of stock'}
              </Button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <Button
                className="w-full"
                variant="secondary"
                disabled={!inStock || whatsappBusy}
                onClick={handleOrderOnWhatsApp}
              >
                {whatsappBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                )}
                {whatsappBusy ? 'Creating secure link…' : 'Order on WhatsApp'}
              </Button>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                The assistant confirms your details and the business approves the order before payment.
              </p>
              {!store.contactPhone ? (
                <p className="mt-1 text-xs text-slate-500">
                  No WhatsApp number is published. You can copy the secure link after creating it.
                </p>
              ) : null}
              {whatsappReference ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-medium text-slate-700">Secure checkout link</p>
                  <input
                    readOnly
                    value={buildCheckoutUrl(whatsappReference.checkoutPath)}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-600"
                    aria-label="Secure checkout link"
                  />
                  <Button className="mt-2" size="sm" variant="ghost" onClick={handleCopyLink}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                </div>
              ) : null}
              {whatsappError ? (
                <Alert className="mt-3" variant="error" title="WhatsApp handoff failed">
                  {whatsappError}
                </Alert>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
              <span className="text-slate-500">Line total</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(getCartSubtotal([{ price: unitPrice, quantity }]), {
                  currency: product.currency,
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
