import type { AttackEvent } from "@/lib/types";

const OUTCOME_STYLE: Record<string, string> = {
  blocked: "text-green-400",
  passed: "text-red-400",
  error: "text-yellow-400",
};

export function EventRow({ event }: { event: AttackEvent }) {
  const time = new Date(event.ts).toLocaleTimeString();
  return (
    <tr className="border-t border-gray-800 hover:bg-gray-900/50">
      <td className="px-3 py-1 text-gray-500">{time}</td>
      <td className="px-3 py-1">{event.category.replace(/_/g, " ")}</td>
      <td className="px-3 py-1 text-blue-300">{event.targetPath}</td>
      <td className="px-3 py-1 text-gray-300">{event.statusCode}</td>
      <td className={`px-3 py-1 font-semibold ${OUTCOME_STYLE[event.outcome] ?? ""}`}>
        {event.outcome}
      </td>
      <td className="px-3 py-1 text-right text-gray-500">{event.durationMs}</td>
    </tr>
  );
}
