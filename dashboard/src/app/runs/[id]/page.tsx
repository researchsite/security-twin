import { RunPage } from "./RunPage";

const DEMO_MODE = process.env.DEMO_MODE !== "false";

export default function RunsPage({ params }: { params: { id: string } }) {
  return <RunPage runId={params.id} demoMode={DEMO_MODE} />;
}
