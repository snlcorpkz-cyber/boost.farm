import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SLIDES = [
  {
    image: '/assets/onboarding/vegetables.webp',
    title: 'Play & Grow Real Vegetables',
    subtitle: 'Choose a crop, take care of it — and receive real organic produce as a reward.',
  },
  {
    image: '/assets/onboarding/watering.webp',
    title: 'Water Every Day',
    subtitle: 'A few taps a day is all it takes. Watch your plant grow from seed to harvest.',
  },
  {
    image: '/assets/onboarding/delivery.webp',
    title: 'Get Fresh Veggies Delivered Home',
    subtitle: 'Once your crop is fully grown, we deliver real vegetables straight to your door.',
  },
] as const;

interface Props {
  onFinish: () => void;
}

export default function OnboardingPage({ onFinish }: Props) {
  const [page, setPage] = useState(0);
  const slide = SLIDES[page];
  const isLast = page === SLIDES.length - 1;

  const next = () => {
    if (isLast) {
      onFinish();
    } else {
      setPage((p) => p + 1);
    }
  };

  return (
    <div className="h-full min-h-[100dvh] bg-white flex flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, x: 80 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -80 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="flex-1 flex flex-col"
        >
          {/* Image */}
          <div className="flex-1 relative overflow-hidden">
            <img
              src={slide.image}
              alt={slide.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
          </div>

          {/* Text */}
          <div className="px-8 pb-4 pt-2 text-center">
            <h2 className="text-2xl font-extrabold text-gray-900 leading-tight">
              {slide.title}
            </h2>
            <p className="mt-3 text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">
              {slide.subtitle}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Dots & Button */}
      <div className="px-8 pb-10 pt-4">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-6">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === page ? 'w-8 bg-green-500' : 'w-2 bg-gray-300'
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-base shadow-lg shadow-green-500/30 hover:shadow-xl active:scale-[0.98] transition-all"
        >
          {isLast ? 'Get Started' : 'Next'}
        </button>

        {!isLast && (
          <button
            onClick={onFinish}
            className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
