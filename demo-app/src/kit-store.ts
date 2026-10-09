export interface Kit {
  id: string;
  ownerId: string;
  title: string;
  repoName: string;
  token: string; // always a fake ghp_FAKE_... value — no real secrets here
}

export const KIT_STORE: Kit[] = [
  {
    id: "kit-alice-1",
    ownerId: "alice",
    title: "Build a Node.js REST API",
    repoName: "buildbridge-node-rest-api",
    token: "ghp_FAKE_alice_aaaa1111aaaa1111aaaa1111aaa1",
  },
  {
    id: "kit-alice-2",
    ownerId: "alice",
    title: "Docker Basics for Developers",
    repoName: "buildbridge-docker-basics",
    token: "ghp_FAKE_alice_bbbb2222bbbb2222bbbb2222bbb2",
  },
  {
    id: "kit-bob-1",
    ownerId: "bob",
    title: "FastAPI Starter Kit",
    repoName: "buildbridge-fastapi-starter",
    token: "ghp_FAKE_bob_cccc3333cccc3333cccc3333ccc3",
  },
  {
    id: "kit-bob-2",
    ownerId: "bob",
    title: "PostgreSQL Local Setup",
    repoName: "buildbridge-postgres-setup",
    token: "ghp_FAKE_bob_dddd4444dddd4444dddd4444ddd4",
  },
  {
    id: "kit-carol-1",
    ownerId: "carol",
    title: "Next.js App Router Project",
    repoName: "buildbridge-nextjs-app",
    token: "ghp_FAKE_carol_eeee5555eeee5555eeee5555eee5",
  },
  {
    id: "kit-carol-2",
    ownerId: "carol",
    title: "Redis Caching Layer",
    repoName: "buildbridge-redis-cache",
    token: "ghp_FAKE_carol_ffff6666ffff6666ffff6666fff6",
  },
];
