"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { setCardDueStatus, setCardPaused } from "@/lib/actions/board";
import { setChecklistItemDone } from "@/lib/actions/card-details";
import { createFocusCard } from "@/lib/actions/focus";
import {
  FOCUS_LANES,
  GROUP_ORDER,
  groupLabel,
  matchesLane,
  type FocusLane,
  type RankedCard,
} from "@/lib/importance";
import type { FocusBoard, FocusItem, FocusWorkspace } from "@/lib/focus";
import { cn } from "@/lib/utils";

// Client half of the Focus pane. Ranking happens on the server (lib/focus.ts)
// so this file only filters, searches, and fires the same card actions the
// board already uses. A viewer can look but the write controls stay hidden —
// the actions would refuse them anyway, and offering them would just fail.

type Props = {
  workspace: FocusWorkspace;
  firstName: string;
};

export function FocusView({ workspace, firstName }: Props) {
  const router = useRouter();
  const [lane, setLane] = React.useState<FocusLane>("focus");
  const [boardId, setBoardId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [composer, setComposer] = React.useState(false);
  const [pendingId, startTransition] = React.useTransition();

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspace.items.filter((item) => {
      if (boardId && item.board.id !== boardId) return false;
      if (!matchesLane(asRanked(item), lane)) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.board.name.toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q) ||
        (item.owner ?? "").toLowerCase().includes(q) ||
        item.checklist.some((check) => check.text.toLowerCase().includes(q))
      );
    });
  }, [workspace.items, lane, boardId, query]);

  const now = visible[0] ?? null;
  const rest = visible.slice(1);

  const grouped = React.useMemo(() => {
    const map = new Map<string, FocusItem[]>();
    for (const label of GROUP_ORDER) map.set(label, []);
    for (const item of rest) {
      const label = groupLabel(asRanked(item));
      map.get(label)?.push(item);
    }
    return GROUP_ORDER.map((label) => ({
      label,
      items: map.get(label) ?? [],
    })).filter((group) => group.items.length > 0);
  }, [rest]);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.getElementById("focus-search")?.focus();
      }
      if (event.key === "n" && !typing) {
        event.preventDefault();
        setComposer(true);
      }
      if (event.key === "Escape") setComposer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function refreshAfter(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  const stats = workspace.stats;
  const editableBoards = workspace.boards.filter((board) => board.canEdit);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {formatToday()}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {firstName}.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.overdue > 0
              ? `${stats.overdue} overdue across ${workspace.boards.length} board${
                  workspace.boards.length === 1 ? "" : "s"
                }.`
              : stats.dueToday > 0
                ? `${stats.dueToday} due today. The rest can wait.`
                : workspace.items.length === 0
                  ? "No cards yet. Open a board to add some."
                  : "Nothing overdue. Work the queue in order."}
          </p>
        </header>

        <div className="mb-4 md:hidden">
          <SearchField value={query} onChange={setQuery} />
        </div>

        <StatStrip stats={stats} lane={lane} onLane={setLane} />

        <div className="mt-4 flex items-center gap-2">
          <div className="hidden min-w-0 flex-1 md:block">
            <SearchField value={query} onChange={setQuery} />
          </div>
          {editableBoards.length > 0 ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setComposer(true)}
              className="shrink-0"
            >
              New card
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto pb-1">
          {FOCUS_LANES.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="focus-lane"
              data-lane={item.id}
              aria-pressed={lane === item.id}
              onClick={() => setLane(item.id)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-xs font-medium",
                lane === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {now ? (
          <NowCard
            item={now}
            busy={pendingId}
            onComplete={() =>
              refreshAfter(() =>
                setCardDueStatus({
                  cardId: now.id,
                  status: now.status === "completed" ? "later" : "completed",
                }),
              )
            }
            onPause={() =>
              refreshAfter(() =>
                setCardPaused({
                  cardId: now.id,
                  paused: now.status !== "paused",
                }),
              )
            }
            onTick={(itemId, done) =>
              refreshAfter(() => setChecklistItemDone({ itemId, done }))
            }
          />
        ) : (
          <EmptyLane
            lane={lane}
            hasBoards={workspace.boards.length > 0}
            canCreate={editableBoards.length > 0}
            onNew={() => setComposer(true)}
          />
        )}

        <div className="mt-8 flex flex-col gap-7">
          {grouped.map((group) => (
            <section key={group.label}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {group.items.length}
                </p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item, index) => (
                  <FocusRow
                    key={item.id}
                    item={item}
                    index={index + 2}
                    busy={pendingId}
                    onToggle={() =>
                      refreshAfter(() =>
                        setCardDueStatus({
                          cardId: item.id,
                          status:
                            item.status === "completed" ? "later" : "completed",
                        }),
                      )
                    }
                    onTick={(itemId, done) =>
                      refreshAfter(() => setChecklistItemDone({ itemId, done }))
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <BoardRail
        boards={workspace.boards}
        items={workspace.items}
        activeId={boardId}
        onSelect={setBoardId}
      />

      {composer ? (
        <Composer
          boards={editableBoards}
          defaultBoardId={boardId ?? editableBoards[0]?.id}
          onClose={() => setComposer(false)}
          onCreated={() => {
            setComposer(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id="focus-search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search cards, boards  (press /)"
      aria-label="Search cards"
    />
  );
}

function StatStrip({
  stats,
  lane,
  onLane,
}: {
  stats: FocusWorkspace["stats"];
  lane: FocusLane;
  onLane: (lane: FocusLane) => void;
}) {
  const items = [
    {
      id: "overdue" as FocusLane,
      label: "Overdue",
      value: stats.overdue,
      tone: "text-destructive",
    },
    {
      id: "today" as FocusLane,
      label: "Today",
      value: stats.dueToday,
      tone: "text-warning",
    },
    {
      id: "week" as FocusLane,
      label: "This week",
      value: stats.thisWeek,
      tone: "text-foreground",
    },
    {
      id: "blocked" as FocusLane,
      label: "Blocked",
      value: stats.blocked,
      tone: "text-foreground",
    },
    {
      id: "focus" as FocusLane,
      label: "Open",
      value: stats.open,
      tone: "text-foreground",
    },
  ];
  return (
    <dl className="grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onLane(item.id)}
          className={cn(
            "bg-surface px-2 py-3 text-left sm:px-4",
            lane === item.id && "bg-card",
          )}
        >
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl",
              item.tone,
            )}
          >
            {item.value}
          </dd>
        </button>
      ))}
    </dl>
  );
}

function NowCard({
  item,
  busy,
  onComplete,
  onPause,
  onTick,
}: {
  item: FocusItem;
  busy: boolean;
  onComplete: () => void;
  onPause: () => void;
  onTick: (itemId: string, done: boolean) => void;
}) {
  return (
    <article
      data-testid="focus-now"
      data-card-title={item.title}
      className="relative mt-5 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", statusBar(item))} />
      <div className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Do this now
          </p>
          <Badge color={item.board.color}>{item.board.name}</Badge>
          <PriorityMark priority={item.priority} />
        </div>
        <Link
          href={`/board/${item.board.id}`}
          className="mt-3 block rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
            {item.title}
          </h3>
          {item.description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </Link>
        {item.reasons.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {item.reasons.join(" · ")}
          </p>
        ) : null}
        <ExpandableChecklist
          items={item.checklist}
          canEdit={item.canEdit}
          defaultOpen
          onTick={onTick}
        />
        <div className="mt-5 flex flex-wrap gap-2">
          {item.canEdit ? (
            <>
              <Button type="button" onClick={onComplete} disabled={busy}>
                {item.status === "completed" ? "Reopen" : "Mark done"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onPause}
                disabled={busy}
              >
                {item.status === "paused" ? "Resume" : "Park"}
              </Button>
            </>
          ) : null}
          <Link
            href={`/board/${item.board.id}`}
            className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Open board
          </Link>
        </div>
      </div>
    </article>
  );
}

function FocusRow({
  item,
  index,
  busy,
  onToggle,
  onTick,
}: {
  item: FocusItem;
  index: number;
  busy: boolean;
  onToggle: () => void;
  onTick: (itemId: string, done: boolean) => void;
}) {
  return (
    <li>
      <div
        data-testid="focus-row"
        data-card-title={item.title}
        className="relative flex items-stretch overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className={cn("w-1 shrink-0", statusBar(item))} />
        {item.canEdit ? (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="grid w-10 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
            aria-label={
              item.status === "completed" ? "Reopen card" : "Complete card"
            }
          >
            <span
              className={cn(
                "grid size-4 place-items-center rounded-sm border text-[10px]",
                item.status === "completed"
                  ? "border-success bg-success text-primary-foreground"
                  : "border-input",
              )}
            >
              {item.status === "completed" ? "✓" : null}
            </span>
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 items-start gap-3 px-1 py-2.5 pr-3">
          <span className="hidden w-6 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground sm:block">
            {String(index).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/board/${item.board.id}`}
              className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "block truncate text-sm font-medium tracking-tight",
                  item.status === "completed" &&
                    "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Badge color={item.board.color}>{item.board.name}</Badge>
                {item.reasons[0] ? <span>{item.reasons[0]}</span> : null}
              </span>
            </Link>
            <ExpandableChecklist
              items={item.checklist}
              canEdit={item.canEdit}
              onTick={onTick}
            />
          </div>
          <span className="hidden shrink-0 sm:block">
            <DueBadge item={item} />
          </span>
        </div>
      </div>
    </li>
  );
}

function ExpandableChecklist({
  items,
  canEdit,
  defaultOpen = false,
  onTick,
}: {
  items: FocusItem["checklist"];
  canEdit: boolean;
  defaultOpen?: boolean;
  onTick: (itemId: string, done: boolean) => void;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (items.length === 0) return null;
  const done = items.filter((item) => item.done).length;
  return (
    <div data-testid="focus-checklist" className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <span className="font-mono tabular-nums">
          {done}/{items.length}
        </span>
        <span>checklist</span>
        <span
          aria-hidden
          className={cn(
            "ml-0.5 inline-block size-0 border-x-[3.5px] border-t-[4px] border-x-transparent border-t-current transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <ul className="mt-0.5 flex flex-col">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-1 hover:bg-accent/70">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!canEdit}
                  aria-label={item.text}
                  onChange={(event) => onTick(item.id, event.target.checked)}
                  className="size-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span
                  className={cn(
                    "text-sm leading-snug",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.text}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyLane({
  lane,
  hasBoards,
  canCreate,
  onNew,
}: {
  lane: FocusLane;
  hasBoards: boolean;
  canCreate: boolean;
  onNew: () => void;
}) {
  return (
    <div className="mt-5 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-lg font-semibold">
        {hasBoards ? "Nothing in this lane" : "No boards yet"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {!hasBoards
          ? "Create a board to start collecting work."
          : lane === "focus"
            ? "Add a card or clear a filter. Empty is a valid state."
            : "Try Focus to see everything that still needs a decision."}
      </p>
      {!hasBoards ? (
        <Link
          href="/boards"
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover"
        >
          Create a board
        </Link>
      ) : canCreate ? (
        <Button type="button" className="mt-4" onClick={onNew}>
          New card
        </Button>
      ) : null}
    </div>
  );
}

function BoardRail({
  boards,
  items,
  activeId,
  onSelect,
}: {
  boards: FocusBoard[];
  items: FocusItem[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const openByBoard = new Map<string, number>();
  for (const item of items) {
    if (item.status === "completed") continue;
    openByBoard.set(item.board.id, (openByBoard.get(item.board.id) ?? 0) + 1);
  }

  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Boards
          </h2>
          <Link
            href="/boards"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Manage
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                activeId === null
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60",
              )}
            >
              <span>All boards</span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {items.filter((item) => item.status !== "completed").length}
              </span>
            </button>
          </li>
          {boards.map((board) => (
            <li key={board.id}>
              <button
                type="button"
                onClick={() =>
                  onSelect(activeId === board.id ? null : board.id)
                }
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                  activeId === board.id
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge color={board.color}>{board.name}</Badge>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {openByBoard.get(board.id) ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Composer({
  boards,
  defaultBoardId,
  onClose,
  onCreated,
}: {
  boards: FocusBoard[];
  defaultBoardId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [boardId, setBoardId] = React.useState(defaultBoardId ?? boards[0]?.id ?? "");
  const [dueDate, setDueDate] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createFocusCard({
        boardId,
        title,
        dueDate: dueDate || null,
        priority: priority || null,
      });
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      onCreated();
    });
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-end bg-foreground/20 p-4 sm:place-items-center"
      onClick={onClose}
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold">New card</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Lands in the first column of the board you pick.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="focus-title">Title</Label>
            <Input
              id="focus-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="focus-board">Board</Label>
            <Select
              id="focus-board"
              value={boardId}
              onChange={(event) => setBoardId(event.target.value)}
            >
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-due">Due</Label>
              <Input
                id="focus-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-priority">Priority</Label>
              <Select
                id="focus-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="">Unset</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
            </div>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !title.trim()}>
            Add card
          </Button>
        </div>
      </form>
    </div>
  );
}

function PriorityMark({ priority }: { priority: FocusItem["priority"] }) {
  if (!priority) return null;
  if (priority !== "URGENT" && priority !== "HIGH") {
    return (
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {priority.toLowerCase()}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-[11px] font-medium uppercase tracking-wider",
        priority === "URGENT" ? "text-destructive" : "text-warning",
      )}
    >
      {priority.toLowerCase()}
    </span>
  );
}

function DueBadge({ item }: { item: FocusItem }) {
  if (item.status === "completed") {
    return <span className="text-[11px] text-success">Done</span>;
  }
  if (item.status === "paused") {
    return <span className="text-[11px] text-muted-foreground">Parked</span>;
  }
  if (item.daysUntilDue === null) {
    return <span className="text-[11px] text-muted-foreground">Unscheduled</span>;
  }
  if (item.daysUntilDue < 0) {
    const n = Math.abs(item.daysUntilDue);
    return (
      <span className="text-[11px] font-medium text-destructive">
        {n === 1 ? "1 day late" : `${n} days late`}
      </span>
    );
  }
  if (item.daysUntilDue === 0) {
    return <span className="text-[11px] font-medium text-warning">Today</span>;
  }
  if (item.daysUntilDue === 1) {
    return <span className="text-[11px] text-foreground">Tomorrow</span>;
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      in {item.daysUntilDue} days
    </span>
  );
}

function statusBar(item: FocusItem): string {
  if (item.status === "overdue") return "bg-destructive";
  if (item.status === "dueNow") return "bg-warning";
  if (item.status === "paused") return "bg-muted-foreground/40";
  if (item.status === "completed") return "bg-success";
  if (item.isBlocked) return "bg-label-slate";
  return "bg-primary";
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Adapter so the pure lane/group helpers can read a FocusItem. The helpers
 * only look at ranking fields; board metadata is unused.
 */
function asRanked(item: FocusItem): RankedCard {
  return {
    id: item.id,
    title: item.title,
    dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00.000Z`) : null,
    pausedAt: item.status === "paused" ? new Date() : null,
    completedAt: item.status === "completed" ? new Date() : null,
    priority: item.priority,
    columnName: item.columnName,
    blockedBy: item.openBlockers.map((title) => ({
      title,
      completed: false,
    })),
    blocking: Array.from({ length: item.blockingCount }, () => ({
      title: "",
    })),
    status: item.status,
    score: item.score,
    reasons: item.reasons,
    isBlocked: item.isBlocked,
    openBlockers: item.openBlockers.map((title) => ({ title })),
    daysUntilDue: item.daysUntilDue,
  };
}
