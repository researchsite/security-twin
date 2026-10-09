import { HomeClient } from "@/components/HomeClient";

const DEMO_MODE = process.env.DEMO_MODE !== "false";
export const DEMO_RUN_ID = "demo-2024-idor";

export default function HomePage() {
  return <HomeClient demoMode={DEMO_MODE} demoRunId={DEMO_RUN_ID} />;
}
