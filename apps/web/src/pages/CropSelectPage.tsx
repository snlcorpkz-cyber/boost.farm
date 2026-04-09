import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useNewCrop } from '../hooks/useFarm';
import { api } from '../lib/api';
import { PRODUCT_PHOTOS } from '../lib/assets';

export default function CropSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const newCrop = useNewCrop();

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => api('/admin/products'),
  });

  const products = productsData?.products || [];

  const handleSelect = (productId: string) => {
    newCrop.mutate(productId, {
      onSuccess: () => navigate('/'),
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-100 to-white px-4 pt-8 pb-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-center text-gray-800 mb-2">
          {t('farm.select_crop')}
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          🌱 {t('farm.select_crop')}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {products.map((product: any) => {
            const stars = product.difficulty_stars;
            const photo = PRODUCT_PHOTOS[product.name_key];
            const available = product.name_key === 'product.potato';
            return (
              <motion.div
                key={product.id}
                className="rounded-2xl p-4 shadow-md border-2 bg-white border-transparent transition-all flex flex-col items-center gap-2 relative"
                whileTap={available ? { scale: 0.95 } : {}}
              >
                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    className="w-36 h-36 object-contain rounded-lg"
                  />
                ) : (
                  <span className="text-5xl">🌱</span>
                )}
                <span className="font-bold text-sm text-gray-800">
                  {t(product.name_key)}
                </span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span
                      key={i}
                      className={`text-xs ${i < stars ? 'text-yellow-400' : 'text-gray-300'}`}
                    >
                      ★
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-gray-400">
                  {t(`difficulty.${stars}`)}
                </span>
                {available ? (
                  <button
                    className="mt-1 px-5 py-1.5 bg-farm-green text-white text-xs font-bold rounded-full shadow active:scale-95 transition-transform"
                    onClick={() => handleSelect(product.id)}
                    disabled={newCrop.isPending}
                  >
                    {t('farm.select_crop')}
                  </button>
                ) : (
                  <span className="mt-1 px-5 py-1.5 bg-gray-200 text-gray-400 text-xs font-bold rounded-full">
                    Soon
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
