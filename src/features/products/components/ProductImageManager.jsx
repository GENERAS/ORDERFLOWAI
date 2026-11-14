import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
} from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import {
  deleteProductImage,
  listProductImages,
  toCatalogueServiceError,
  updateProductImage,
  uploadProductImage,
} from '../../../services/catalogueService';

export function ProductImageManager({ businessId, productId }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [altDrafts, setAltDrafts] = useState({});
  const fileInputRef = useRef(null);

  const loadImages = async () => {
    const rows = await listProductImages({ businessId, productId });
    setImages(rows);
    setAltDrafts(
      Object.fromEntries(rows.map((image) => [image.id, image.altText ?? ''])),
    );
  };

  useEffect(() => {
    let active = true;

    listProductImages({ businessId, productId })
      .then((rows) => {
        if (!active) return;
        setImages(rows);
        setError('');
        setAltDrafts(
          Object.fromEntries(
            rows.map((image) => [image.id, image.altText ?? '']),
          ),
        );
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

  const handleUpload = async (event) => {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      for (const file of files) {
        await uploadProductImage({
          businessId,
          productId,
          file,
          isPrimary: images.length === 0 && file === files[0],
        });
      }
      await loadImages();
      setSuccess(
        `${files.length} image${files.length === 1 ? '' : 's'} uploaded.`,
      );
    } catch (uploadError) {
      setError(toCatalogueServiceError(uploadError).message);
      await loadImages().catch(() => {});
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePrimary = async (image) => {
    setWorkingId(image.id);
    setError('');
    setSuccess('');
    try {
      await updateProductImage({
        businessId,
        productId,
        imageId: image.id,
        isPrimary: true,
      });
      await loadImages();
      setSuccess('Primary image updated.');
    } catch (updateError) {
      setError(toCatalogueServiceError(updateError).message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleDelete = async (image) => {
    if (!window.confirm('Delete this product image?')) return;

    setWorkingId(image.id);
    setError('');
    setSuccess('');
    try {
      await deleteProductImage({ businessId, productId, image });
      await loadImages();
      setSuccess('Image deleted.');
    } catch (deleteError) {
      setError(toCatalogueServiceError(deleteError).message);
    } finally {
      setWorkingId(null);
    }
  };

  const handleAltSave = async (image) => {
    setWorkingId(image.id);
    setError('');
    setSuccess('');
    try {
      await updateProductImage({
        businessId,
        productId,
        imageId: image.id,
        altText: altDrafts[image.id] ?? '',
      });
      await loadImages();
      setSuccess('Image description saved.');
    } catch (updateError) {
      setError(toCatalogueServiceError(updateError).message);
    } finally {
      setWorkingId(null);
    }
  };

  const moveImage = async (image, direction) => {
    const index = images.findIndex((item) => item.id === image.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= images.length) return;

    const target = images[targetIndex];
    setWorkingId(image.id);
    setError('');
    setSuccess('');

    try {
      await updateProductImage({
        businessId,
        productId,
        imageId: image.id,
        sortOrder: target.sortOrder,
      });
      await updateProductImage({
        businessId,
        productId,
        imageId: target.id,
        sortOrder: image.sortOrder,
      });
      await loadImages();
    } catch (moveError) {
      setError(toCatalogueServiceError(moveError).message);
      await loadImages().catch(() => {});
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Product photos</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            JPEG, PNG, WebP or AVIF. Maximum 5 MB each. Photos are stored privately.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            id="product-image-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="sr-only"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
            )}
            {uploading ? 'Uploading…' : 'Upload images'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading images…
        </div>
      ) : null}

      {!loading && images.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          No product photos yet.
        </p>
      ) : null}

      {images.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {images.map((image, index) => {
            const isWorking = workingId === image.id;
            return (
              <div
                key={image.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="relative aspect-[4/3] bg-slate-100">
                  {image.url ? (
                    <img
                      src={image.url}
                      alt={image.altText || 'Product image'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      Preview unavailable
                    </div>
                  )}
                  {image.isPrimary ? (
                    <Badge
                      variant="brand"
                      className="absolute left-3 top-3 bg-white/95"
                    >
                      <Star className="h-3 w-3" aria-hidden="true" />
                      Primary
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-3 p-4">
                  <FormField
                    id={`image-alt-${image.id}`}
                    label="Image description"
                    value={altDrafts[image.id] ?? ''}
                    onChange={(event) =>
                      setAltDrafts((current) => ({
                        ...current,
                        [image.id]: event.target.value,
                      }))
                    }
                    maxLength={300}
                    hint="Describe the photo for accessibility and future AI search."
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAltSave(image)}
                      disabled={isWorking}
                    >
                      {isWorking ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      Save description
                    </Button>
                    {!image.isPrimary ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePrimary(image)}
                        disabled={isWorking}
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        Make primary
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveImage(image, -1)}
                      disabled={isWorking || index === 0}
                      aria-label="Move image up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveImage(image, 1)}
                      disabled={isWorking || index === images.length - 1}
                      aria-label="Move image down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(image)}
                      disabled={isWorking}
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
