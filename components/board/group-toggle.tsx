import Link from "next/link";

/**
 * Switch between the two ways of laying out the same cards: by column (the
 * Kanban stages you defined) or by due status (Overdue / Due Now / Later /
 * Paused, derived from each card's date).
 *
 * A pair of links rather than client state, so the choice lives in the URL —
 * it survives a reload, and a schedule view can be bookmarked or shared.
 */
export function GroupToggle({
  boardId,
  active,
}: {
  boardId: string;
  active: "column" | "due";
}) {
  const options = [
    { key: "column" as const, label: "Columns", href: `/board/${boardId}` },
    { key: "due" as const, label: "Schedule", href: `/board/${boardId}?group=due` },
  ];

  return (
    <div
      role="group"
      aria-label="Group cards by"
      className="flex items-center rounded-md border border-border p-0.5"
    >
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          aria-current={active === option.key ? "true" : undefined}
          data-testid={`group-${option.key}`}
          className={`rounded px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            active === option.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
