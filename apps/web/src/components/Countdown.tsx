import { formatCountdown } from "@/lib/format";
import { useNow } from "@/hooks/usePipeline";

export default function Countdown({ deadlineTimestamp }: { deadlineTimestamp: bigint }) {
  const now = useNow();
  const remaining = Number(deadlineTimestamp) - now;
  // Under a minute is the moment a payer needs to feel urgency.
  const urgent = remaining > 0 && remaining < 60;
  return (
    <span className={urgent ? "status-lapsed" : undefined}>
      {formatCountdown(remaining)}
    </span>
  );
}
