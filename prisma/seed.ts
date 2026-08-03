// Seed script for local development.
//
// Creates one demo user with a fully-populated Kanban board (three columns,
// several cards) so the app has realistic data to render before auth and the
// board UI are wired. Run with `npm run db:seed` (configured as Prisma's seed
// command in prisma.config.ts, so it also runs after `prisma migrate reset`).
//
// The script talks to Postgres through the same node-postgres driver adapter the
// app uses (see lib/prisma.ts) rather than a bundled query engine. It is
// idempotent: the demo user is upserted by email and their boards are cleared
// (cascading to columns and cards) before being recreated, so re-running always
// yields the same known state.
//
// DEVELOPMENT AND TEST ONLY. This creates a well-known account with a published
// password and deletes that user's existing boards on every run — never point it
// at a production database. See DEPLOYMENT.md §6.2.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Demo credentials. The password is stored as a bcrypt hash (never plaintext);
// the Auth.js credentials provider (later card) verifies against this same hash.
const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password123";

// Columns are ordered left-to-right and cards top-to-bottom by a Float
// `position`. Seed positions are spaced by 1000 so a card dropped between two
// neighbors can take their midpoint many times over without needing a rebalance.
const POSITION_STEP = 1000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — refusing to guess a seed target.");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: "Demo User" },
    create: { email: DEMO_EMAIL, passwordHash, name: "Demo User" },
  });

  // Clear any existing boards for the demo user so re-seeding is deterministic.
  // The cascade (board → columns → cards) removes all dependent rows.
  await prisma.board.deleteMany({ where: { ownerId: user.id } });

  // Board with its columns and cards defined declaratively, then created with
  // nested writes so positions stay in sync with declaration order.
  const columns: {
    name: string;
    cards: { title: string; description?: string }[];
  }[] = [
    {
      name: "To Do",
      cards: [
        {
          title: "Set up project repository",
          description: "Initialize the repo and push the scaffold.",
        },
        {
          title: "Draft product requirements",
          description: "Capture the MVP scope and acceptance criteria.",
        },
        {
          title: "Design database schema",
          description: "Model users, boards, columns, and cards.",
        },
      ],
    },
    {
      name: "In Progress",
      cards: [
        {
          title: "Build board view",
          description: "Render columns and cards from the database.",
        },
        {
          title: "Wire up credential auth",
          description: "Add Auth.js login and protect board routes.",
        },
      ],
    },
    {
      name: "Done",
      cards: [
        {
          title: "Scaffold Next.js app",
          description: "App Router + TypeScript + Tailwind.",
        },
        {
          title: "Configure Prisma + Postgres",
          description: "Driver adapter and shared client singleton.",
        },
      ],
    },
  ];

  const board = await prisma.board.create({
    data: {
      name: "Product Roadmap",
      ownerId: user.id,
      columns: {
        create: columns.map((column, columnIndex) => ({
          name: column.name,
          position: (columnIndex + 1) * POSITION_STEP,
          cards: {
            create: column.cards.map((card, cardIndex) => ({
              title: card.title,
              description: card.description,
              position: (cardIndex + 1) * POSITION_STEP,
            })),
          },
        })),
      },
    },
  });

  const cardCount = columns.reduce((sum, c) => sum + c.cards.length, 0);
  console.log(
    `Seeded user ${user.email} with board "${board.name}" ` +
      `(${columns.length} columns, ${cardCount} cards).`,
  );
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
