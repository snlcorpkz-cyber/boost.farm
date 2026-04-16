import { useState } from 'react';
import { motion } from 'framer-motion';
import { UI } from '../../lib/assets';
import { sounds } from '../../lib/sounds';

interface BucketProps {
  fillPercent: number;
  isFull: boolean;
  bucketLevel: number;
  capacity: number;
  onCollect: () => void;
  isCollecting: boolean;
  onShakeCan: () => void;
  isDark?: boolean;
}

export default function Bucket({
  fillPercent,
  isFull,
  bucketLevel,
  capacity,
  onCollect,
  isCollecting,
  onShakeCan,
  isDark = false,
}: BucketProps) {
  const [shaking, setShaking] = useState(false);

  const handleTap = () => {
    if (isCollecting || bucketLevel < 0.01 || shaking) return;
    sounds.bucketCollectToCan();
    setShaking(true);
    onShakeCan();
    setTimeout(() => {
      onCollect();
      setShaking(false);
    }, 600);
  };

  const bucketSrc = fillPercent > 66 ? UI.bucketFull : UI.bucket;

  return (
    <div className="relative" style={{ width: 110, height: 140 }}>
      {/* Well */}
      <img
        src={UI.well}
        alt=""
        className="absolute top-0 left-0 object-contain"
        style={{ width: 96, height: 96 }}
        draggable={false}
      />

      {/* Drops from the spout into bucket */}
      <div className="absolute" style={{ left: 62, top: 44, width: 8, height: 28 }}>
        {bucketLevel > 0 && !isFull && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.img
                key={i}
                src={UI.waterDrop}
                alt=""
                className="absolute w-2.5 h-2.5"
                animate={{
                  y: [0, 24],
                  opacity: [1, 0],
                  scale: [0.7, 0.3],
                }}
                transition={{
                  duration: 1,
                  delay: i * 0.33,
                  repeat: Infinity,
                  ease: 'easeIn',
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Bucket — under the spout */}
      <motion.button
        className="absolute overflow-visible"
        style={{ left: 48, top: 74, width: 40, height: 40 }}
        onClick={handleTap}
        disabled={isCollecting || bucketLevel < 0.01 || shaking}
        animate={
          shaking
            ? { x: [0, -3, 3, -2, 2, 0], rotate: [0, -3, 3, -2, 2, 0] }
            : {}
        }
        transition={{ duration: 0.5 }}
      >
        <img
          src={bucketSrc}
          alt=""
          className="w-full h-full object-contain"
          draggable={false}
        />
        {isFull && (
          <motion.div
            className="absolute -top-5 -right-3 bg-gradient-to-b from-yellow-400 to-orange-500 rounded-full px-2 py-0.5 shadow-lg border border-white/60"
            animate={{ scale: [1, 1.15, 1], y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 1, ease: 'easeInOut' }}
          >
            <span className="text-white text-[9px] font-extrabold drop-shadow">TAP!</span>
          </motion.div>
        )}
      </motion.button>

      {/* Water level — centered under the bucket */}
      <div
        className="absolute text-center"
        style={{ left: 48, top: 116, width: 40 }}
      >
        <span className={`text-[9px] font-bold tabular-nums ${isDark ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-blue-800'}`}>
          {bucketLevel.toFixed(2)}g
        </span>
      </div>
    </div>
  );
}
