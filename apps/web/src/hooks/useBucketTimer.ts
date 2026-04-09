import { useState, useEffect, useRef } from 'react';
import {
  type PetId,
  getEffectiveBucketCapacity,
  getEffectiveFillRate,
} from '@eco-farm/game-engine';

export function useBucketTimer(
  lastCollectedAt: string | null,
  activePet?: PetId | null
) {
  const [bucketLevel, setBucketLevel] = useState(0);
  const rafRef = useRef<number>(0);

  const capacity = getEffectiveBucketCapacity(activePet);
  const fillRate = getEffectiveFillRate(activePet);

  useEffect(() => {
    if (!lastCollectedAt) return;

    function tick() {
      const elapsed = (Date.now() - new Date(lastCollectedAt!).getTime()) / 60000;
      const level = Math.min(capacity, elapsed * fillRate);
      setBucketLevel(parseFloat(level.toFixed(2)));
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastCollectedAt, capacity, fillRate]);

  const fillPercent = (bucketLevel / capacity) * 100;
  const isFull = bucketLevel >= capacity;
  const minutesToFull = isFull ? 0 : Math.ceil((capacity - bucketLevel) / fillRate);

  return { bucketLevel, fillPercent, isFull, minutesToFull, capacity };
}
