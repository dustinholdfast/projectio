import {
  Badge,
  type BadgeColor,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = { title: "Design System — TestProject" };

const swatches: { name: string; className: string }[] = [
  { name: "background", className: "bg-background" },
  { name: "surface", className: "bg-surface" },
  { name: "card", className: "bg-card" },
  { name: "muted", className: "bg-muted" },
  { name: "primary", className: "bg-primary" },
  { name: "accent", className: "bg-accent" },
  { name: "destructive", className: "bg-destructive" },
  { name: "border", className: "bg-border" },
];

const labelColors: BadgeColor[] = [
  "slate",
  "blue",
  "amber",
  "green",
  "rose",
  "violet",
];

// A tiny board mock so column + card composition is visible at a glance.
const columns = [
  { title: "Backlog", color: "slate" as BadgeColor, cards: ["Draft spec", "Collect feedback"] },
  { title: "In Progress", color: "amber" as BadgeColor, cards: ["Design system", "Auth flow"] },
  { title: "Done", color: "green" as BadgeColor, cards: ["Scaffold app"] },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Design System</h1>
          <p className="text-sm text-muted-foreground">
            &ldquo;Calm Focus&rdquo; — tokens &amp; primitives for the task board.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map((s) => (
            <div key={s.name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-md border border-border ${s.className}`} />
              <span className="text-xs text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="demo-email">Email</Label>
          <Input id="demo-email" type="email" placeholder="you@example.com" />
        </div>
      </Section>

      <Section title="Labels">
        <div className="flex flex-wrap gap-2">
          {labelColors.map((c) => (
            <Badge key={c} color={c}>
              {c}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Board composition">
        <div className="grid gap-4 sm:grid-cols-3">
          {columns.map((col) => (
            <div key={col.title} className="flex flex-col gap-3 rounded-lg bg-surface p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{col.title}</span>
                  <Badge color={col.color}>{col.cards.length}</Badge>
                </div>
              </div>
              {col.cards.map((c) => (
                <Card key={c}>
                  <CardHeader>
                    <CardTitle className="text-sm">{c}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge color={col.color}>{col.title}</Badge>
                  </CardContent>
                </Card>
              ))}
              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground">
                + Add card
              </Button>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
