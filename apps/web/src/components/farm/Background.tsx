import { usePhase } from '../../hooks/usePhase';
import { BG } from '../../lib/assets';

// NOTE: /assets/bg/afternoon.webp does not ship with the app (never committed),
// so we fall back to morning.webp for the daytime phase. If/when an
// afternoon-specific asset is added, switching back is a one-line change.
const PHASE_BG: Record<string, string> = {
  morning: BG.morning,
  afternoon: BG.morning,
  evening: BG.evening,
};

function isNight(hour: number): boolean {
  return hour >= 22 || hour < 4;
}

export default function Background({ children }: { children: React.ReactNode }) {
  const { phase } = usePhase();
  const hour = new Date().getHours();
  const night = isNight(hour);

  const bgImage = night ? BG.night : PHASE_BG[phase] || BG.morning;

  return (
    <div className="relative h-full overflow-hidden bg-[#1a3a2a]">
      <img
        src={bgImage}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      {night && (
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-yellow-100/8 blur-3xl pointer-events-none" />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
