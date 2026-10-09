import { RunView } from "@/components/RunView";
import { getDemoRun } from "@/lib/demo";

const DEMO_MODE = process.env.DEMO_MODE !== "false";

export default async function HomePage() {
  const run = DEMO_MODE ? await getDemoRun() : null;

  return (
    <main className="min-h-screen p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-green-400">Security Twin</h1>
        {DEMO_MODE && (
          <span className="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black">
            DEMO MODE — recorded run
          </span>
        )}
      </header>

      <RunView initialRun={run} demoMode={DEMO_MODE} />
    </main>
  );
}
