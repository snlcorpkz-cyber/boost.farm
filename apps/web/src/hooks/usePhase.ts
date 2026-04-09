import { useState, useEffect } from 'react';
import { getCurrentPhase, getPhaseInfo, Phase } from '@eco-farm/game-engine';

export function usePhase() {
  const [phase, setPhase] = useState<Phase>(() => getCurrentPhase(new Date().getHours()));
  const [hoursRemaining, setHoursRemaining] = useState(0);

  useEffect(() => {
    function update() {
      const hour = new Date().getHours();
      const info = getPhaseInfo(hour);
      setPhase(info.phase);
      setHoursRemaining(info.hoursRemaining);
    }

    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  return { phase, hoursRemaining };
}
