import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getCropFrames, getCropBase } from '../../lib/assets';

interface PlantProps {
  stage: number;
  growthPercent: number;
  productNameKey: string;
  isWatering: boolean;
  showEarth?: boolean;
}

const STAGE_SIZE: Record<number, number> = {
  1: 28,
  2: 56,
  3: 88,
  4: 137,
  5: 118,
  6: 142,
};

const EARTH_ASPECT = 715 / 349;
const FIXED_EARTH_WIDTH = 200;
const FIXED_EARTH_HEIGHT = FIXED_EARTH_WIDTH / EARTH_ASPECT;

export function getPlantLayout(_stage?: number) {
  return {
    baseWidth: FIXED_EARTH_WIDTH,
    earthHeight: FIXED_EARTH_HEIGHT,
  };
}

export default function Plant({ stage, productNameKey, isWatering, showEarth = true }: PlantProps) {
  const [eyesOpen, setEyesOpen] = useState(true);
  const frames = getCropFrames(productNameKey, stage);
  const base = getCropBase(productNameKey);
  const sz = STAGE_SIZE[stage] || STAGE_SIZE[3];

  const blink = useCallback(() => {
    setEyesOpen(false);
    setTimeout(() => setEyesOpen(true), 150);
  }, []);

  useEffect(() => {
    const schedule = () => 2000 + Math.random() * 4000;
    let timeout: ReturnType<typeof setTimeout>;
    function loop() {
      timeout = setTimeout(() => {
        blink();
        loop();
      }, schedule());
    }
    loop();
    return () => clearTimeout(timeout);
  }, [blink]);

  const currentFrame = frames ? (eyesOpen ? frames.open : frames.closed) : null;

  const plantImage = currentFrame ? (
    <img
      src={currentFrame}
      alt=""
      className="w-full h-full object-contain object-bottom drop-shadow-lg"
      draggable={false}
    />
  ) : (
    <div className="w-full h-full flex items-end justify-center text-6xl select-none">🌱</div>
  );

  if (!showEarth) {
    return (
      <div className="w-full flex justify-center">
        <motion.div
          style={{ width: sz, height: sz }}
          animate={{
            rotate: isWatering ? [0, -6, 6, -4, 4, 0] : [0, -2, 2, -1, 1, 0],
          }}
          transition={{
            duration: isWatering ? 0.5 : 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {plantImage}
        </motion.div>
      </div>
    );
  }

  const plantBottom = FIXED_EARTH_HEIGHT / 2;

  return (
    <div className="relative" style={{ width: FIXED_EARTH_WIDTH, height: FIXED_EARTH_HEIGHT + sz }}>
      <img
        src={base}
        alt=""
        className="absolute bottom-0 left-0"
        style={{ width: FIXED_EARTH_WIDTH, height: FIXED_EARTH_HEIGHT }}
        draggable={false}
      />

      <motion.div
        className="absolute"
        style={{
          width: sz,
          height: sz,
          bottom: plantBottom,
          left: '50%',
          marginLeft: -(sz / 2),
        }}
        animate={{
          rotate: isWatering ? [0, -6, 6, -4, 4, 0] : [0, -2, 2, -1, 1, 0],
        }}
        transition={{
          duration: isWatering ? 0.5 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        {plantImage}
      </motion.div>
    </div>
  );
}
