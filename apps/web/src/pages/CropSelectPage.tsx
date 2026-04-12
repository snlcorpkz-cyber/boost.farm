import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNewCrop } from '../hooks/useFarm';
import { api } from '../lib/api';
import { PRODUCT_PHOTOS } from '../lib/assets';

export default function CropSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const newCrop = useNewCrop();

  const { data: productsData, isLoading, error, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: () => api('/admin/products'),
    retry: 3,
    retryDelay: 1000,
  });

  const products = productsData?.products || [];

  const handleSelect = (productId: string) => {
    newCrop.mutate(productId, {
      onSuccess: () => navigate('/'),
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-green-100 to-white flex items-center justify-center">
        <div className="animate-bounce text-5xl">🌱</div>
      </div>
    );
  }

  if (error || products.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-green-100 to-white flex flex-col items-center justify-center px-6 gap-4">
        <span className="text-5xl">⚠️</span>
        <p className="text-sm text-gray-600 text-center">
          {(error as any)?.message || 'Failed to load products'}
        </p>
        <button
          onClick={() => refetch()}
          className="px-6 py-2 bg-farm-green text-white rounded-xl font-bold text-sm"
        >
          {t('notif.load_more') || 'Retry'}
        </button>
      </div>
    );
  }

  const easy = products.filter((p: any) => p.difficulty_stars === 1);
  const hard = products.filter((p: any) => p.difficulty_stars === 2);

  const renderCard = (product: any) => {
    const photo = PRODUCT_PHOTOS[product.name_key];
    const available = product.name_key === 'product.potato';
    return (
      <button
        key={product.id}
        type="button"
        className={`rounded-2xl p-4 shadow-md border-2 bg-white transition-all flex flex-col items-center gap-2 relative active:scale-95 ${
          available
            ? 'border-transparent active:border-farm-green'
            : 'border-transparent opacity-50 grayscale-[40%]'
        }`}
        onClick={() => available && handleSelect(product.id)}
        disabled={!available || newCrop.isPending}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            className="w-28 h-28 object-contain rounded-lg pointer-events-none"
          />
        ) : (
          <div className="w-28 h-28 rounded-lg bg-gray-100 flex items-center justify-center pointer-events-none">
            <span className="text-4xl">🌱</span>
          </div>
        )}
        <span className="font-bold text-sm text-gray-800 pointer-events-none">
          {t(product.name_key)}
        </span>
        {product.coupon_value_cents > 0 && (
          <span className="text-[11px] font-semibold text-emerald-600 pointer-events-none">
            🎟️ ${(product.coupon_value_cents / 100).toFixed(2)} {t('coupon.discount')}
          </span>
        )}
        {available ? (
          <span className="mt-1 px-5 py-1.5 bg-farm-green text-white text-xs font-bold rounded-full shadow pointer-events-none">
            {t('farm.select_crop')}
          </span>
        ) : (
          <span className="mt-1 px-5 py-1.5 bg-gray-200 text-gray-400 text-xs font-bold rounded-full pointer-events-none">
            Soon
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="h-[100dvh] bg-gradient-to-b from-green-100 to-white flex flex-col overflow-hidden">
      <div className="pt-8 px-4 pb-2 shrink-0">
        <h1 className="text-2xl font-extrabold text-center text-gray-800 mb-1">
          {t('farm.select_crop')}
        </h1>
        <p className="text-sm text-gray-500 text-center">
          Choose a vegetable to grow
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {easy.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                Easy
              </span>
              <span className="text-[11px] text-gray-400">~40,420g water</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {easy.map(renderCard)}
            </div>
          </div>
        )}

        {hard.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">
                Hard
              </span>
              <span className="text-[11px] text-gray-400">~62,500g water</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {hard.map(renderCard)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
