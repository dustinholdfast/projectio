"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Badge,
  type BadgeColor,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { AddCardForm } from "@/components/board/add-card-form";
import { AddColumnForm } from "@/components/board/add-column-form";
import { CardSchedule } from "@/components/board/card-schedule";
import { CardDialog } from "@/components/board/card-dialog";
import {
  reorderCard,
  reorderColumn,
  setCardDueStatus,
} from "@/lib/actions/board";
import { planCardMove, planColumnMove } from "@/lib/reorder";
import {
  DUE_STATUS_DROPPABLE,
  DUE_STATUS_LABEL,
  DUE_STATUS_ORDER,
  type DueStatus,
  dayKeyOfDueDate,
  dueStatusOf,
  groupByDueStatus,
  scheduleForStatus,
} from "@/lib/due-status";
import type {
  BoardCard,
  BoardWithColumns,
  ColumnWithCards,
} from "@/lib/board";

// Client board surface. Renders the board's columns and cards and makes both
// draggable with @dnd-kit: columns reorder horizontally, cards reorder within a
// column and move between columns. A drop updates local state optimistically and
// then persists the single moved row through the reorder server actions; if the
// server rejects the move we roll back and refresh from the source of truth.
//
// Presentation follows the "Calm Focus" direction: a column and its cards share
// one board-palette hue, all driven by semantic tokens (see the hue helpers at
// the foot of this file, ported from the server view they replace).

type DragKind =
  | { type: "column"; column: ColumnWithCards; hue: BadgeColor }
  | { type: "card"; card: BoardCard; hue: BadgeColor; tag: string };

/**
 * "Open this card's detail dialog", supplied by BoardView.
 *
 * Context rather than a prop: cards render three layers down through two
 * different paths (sortable in the column view, draggable in the schedule view),
 * and threading a callback through every shell for one leaf concern makes those
 * components harder to read than the indirection costs.
 */
const OpenCardContext = React.createContext<(cardId: string) => void>(() => {});

/**
 * Whether the viewer may change anything.
 *
 * Context for the same reason as OpenCardContext: cards and columns render
 * several layers down through two different paths, and read-only affects nearly
 * every leaf. This hides affordances only — the server actions enforce the role
 * independently, so a viewer who forges a request is still refused.
 */
const CanEditContext = React.createContext(true);

export function BoardView({
  board,
  groupBy = "column",
  canEdit = true,
}: {
  board: BoardWithColumns;
  /** Which lanes to render. Driven by the `?group=` param so it survives reload. */
  groupBy?: "column" | "due";
  /** False for viewers: drag is disabled and the create/edit controls are hidden. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = React.useState<ColumnWithCards[]>(board.columns);
  const [active, setActive] = React.useState<DragKind | null>(null);
  const [, startTransition] = React.useTransition();

  // "Today" is read once per render pass rather than per card, so every card in
  // one render is bucketed against the same instant — otherwise a render that
  // straddles midnight could place two equally-dated cards in different lanes.
  // Recomputed when fresh board data arrives, which is also the moment a
  // long-open tab would want a newer "today". `board` is the signal for that, not
  // an input to the computation, hence the exhaustive-deps exception.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = React.useMemo(() => new Date(), [board]);

  // Which card's detail dialog is open, by id. Held as an id rather than the
  // card object so the dialog re-reads from `columns` after a save and shows the
  // updated card instead of the snapshot it was opened with.
  const [openCardId, setOpenCardId] = React.useState<string | null>(null);
  const openCard = openCardId
    ? columns.flatMap((c) => c.cards).find((k) => k.id === openCardId) ?? null
    : null;

  // Re-sync from the server whenever a fresh board arrives (after revalidation).
  // Our optimistic state already matches a successful move, so this is a no-op in
  // the happy path and a correction if the server diverged.
  React.useEffect(() => {
    setColumns(board.columns);
  }, [board]);

  // A viewer has nothing to drag. Disabling at the sensor keeps the cards inert
  // rather than letting them move and then bounce back when the server refuses.
  const sensors = useSensors(
    // A small activation distance lets clicks on the in-column "add card" controls
    // through instead of being swallowed as drags.
    useSensor(PointerSensor, {
      activationConstraint: canEdit ? { distance: 6 } : { distance: Infinity },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const hueFor = React.useCallback(
    (columnId: string): BadgeColor => {
      const index = columns.findIndex((c) => c.id === columnId);
      const column = columns[index];
      return columnHue(column?.name ?? "", index < 0 ? 0 : index);
    },
    [columns],
  );

  function findColumnOfCard(cardId: string): ColumnWithCards | undefined {
    return columns.find((c) => c.cards.some((k) => k.id === cardId));
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (data?.type === "column") {
      const column = columns.find((c) => c.id === event.active.id);
      if (column) setActive({ type: "column", column, hue: hueFor(column.id) });
    } else if (data?.type === "card") {
      const column = findColumnOfCard(String(event.active.id));
      const card = column?.cards.find((k) => k.id === event.active.id);
      if (column && card) {
        setActive({ type: "card", card, hue: hueFor(column.id), tag: column.name });
      }
    }
  }

  function persist(action: () => Promise<{ error: string } | undefined>) {
    const snapshot = columns;
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        // Roll back to the pre-drag arrangement and pull the truth from the server.
        setColumns(snapshot);
        router.refresh();
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    setActive(null);
    if (!canEdit) return;
    if (!over) return;

    const kind = dragged.data.current?.type;

    // ── Due-status lane move ────────────────────────────────────────────────
    // In due mode a drop changes *when* a card is due, not where it sits: the
    // lane is derived, so we write dueDate/pausedAt and let the grouping follow.
    // Cards keep their column throughout — this view never moves work between
    // stages.
    if (groupBy === "due") {
      if (kind !== "card") return;
      const target = over.data.current?.dueStatus as DueStatus | undefined;
      if (!target) return;

      const cardId = String(dragged.id);
      const card = columns.flatMap((c) => c.cards).find((k) => k.id === cardId);
      if (!card) return;
      if (dueStatusOf(card, now) === target) return;

      const schedule = scheduleForStatus(target, now, card);
      if (!schedule) return; // Overdue: not a reachable target.

      setColumns((prev) =>
        prev.map((column) => ({
          ...column,
          cards: column.cards.map((k) =>
            k.id === cardId ? { ...k, ...schedule } : k,
          ),
        })),
      );
      persist(() => setCardDueStatus({ cardId, status: target }));
      return;
    }

    // ── Column reorder ──────────────────────────────────────────────────────
    // The drop decision (new order + neighbors) lives in the pure planner; here
    // we only apply it optimistically and persist the moved row.
    if (kind === "column") {
      const overColumnId =
        over.data.current?.type === "column"
          ? String(over.id)
          : findColumnOfCard(String(over.id))?.id;
      if (!overColumnId) return;

      const plan = planColumnMove(columns, String(dragged.id), overColumnId);
      if (!plan) return;

      const byId = new Map(columns.map((c) => [c.id, c]));
      setColumns(plan.columnIds.map((id) => byId.get(id)!));
      persist(() =>
        reorderColumn({
          columnId: String(dragged.id),
          prevColumnId: plan.prevColumnId,
          nextColumnId: plan.nextColumnId,
        }),
      );
      return;
    }

    // ── Card reorder / move ─────────────────────────────────────────────────
    if (kind !== "card") return;
    const cardId = String(dragged.id);
    const overType = over.data.current?.type === "column" ? "column" : "card";

    const plan = planCardMove(columns, cardId, { id: String(over.id), type: overType });
    if (!plan) return;

    // Rebuild the destination column's card objects from the planned id order,
    // stamping the moved card with its new column for a cross-column move.
    const cardsById = new Map<string, BoardCard>();
    for (const c of columns) for (const k of c.cards) cardsById.set(k.id, k);
    const destCards = plan.cardIds.map((id) =>
      id === cardId
        ? { ...cardsById.get(id)!, columnId: plan.toColumnId }
        : cardsById.get(id)!,
    );

    setColumns((prev) =>
      prev.map((c) => {
        if (c.id === plan.toColumnId) return { ...c, cards: destCards };
        if (c.id === plan.fromColumnId)
          return { ...c, cards: c.cards.filter((k) => k.id !== cardId) };
        return c;
      }),
    );
    persist(() =>
      reorderCard({
        cardId,
        toColumnId: plan.toColumnId,
        prevCardId: plan.prevCardId,
        nextCardId: plan.nextCardId,
      }),
    );
  }

  return (
    <OpenCardContext.Provider value={setOpenCardId}>
    <CanEditContext.Provider value={canEdit}>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <section className="flex flex-1 items-start gap-4 overflow-x-auto p-4 sm:p-6">
        {groupBy === "due" ? (
          <DueLanes columns={columns} now={now} hueFor={hueFor} />
        ) : (
          <>
            <SortableContext
              items={columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {columns.map((column, index) => (
                <SortableColumn
                  key={column.id}
                  column={column}
                  hue={columnHue(column.name, index)}
                />
              ))}
            </SortableContext>
            {canEdit ? <AddColumnForm boardId={board.id} /> : null}
          </>
        )}
      </section>

      <DragOverlay>
        {active?.type === "column" ? (
          <ColumnShell column={active.column} hue={active.hue} dragging />
        ) : active?.type === "card" ? (
          <TaskCardShell card={active.card} hue={active.hue} tag={active.tag} dragging />
        ) : null}
      </DragOverlay>

      {openCard ? (
        <CardDialog
          card={openCard}
          columns={columns}
          canEdit={canEdit}
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </DndContext>
    </CanEditContext.Provider>
    </OpenCardContext.Provider>
  );
}

// ── Due-status lanes ─────────────────────────────────────────────────────────
//
// The schedule view. Lanes are derived from each card's dueDate/pausedAt, so
// unlike columns they are fixed, cannot be reordered, and hold no `position` of
// their own — which is why cards here are plain draggables rather than sortables:
// there is nowhere to persist an order *within* a lane, so offering one would be
// a lie. Cards sort by due date, soonest first.

function DueLanes({
  columns,
  now,
  hueFor,
}: {
  columns: ColumnWithCards[];
  now: Date;
  hueFor: (columnId: string) => BadgeColor;
}) {
  // Flatten every column's cards, remembering which column each came from so the
  // card keeps its stage tag and hue in this view.
  const all = React.useMemo(
    () =>
      columns.flatMap((column) =>
        column.cards.map((card) => ({ card, columnName: column.name })),
      ),
    [columns],
  );

  const grouped = React.useMemo(
    () => groupByDueStatus(all.map((entry) => entry.card), now),
    [all, now],
  );
  const columnNameOf = React.useMemo(
    () => new Map(all.map((entry) => [entry.card.id, entry.columnName])),
    [all],
  );

  return (
    <>
      {DUE_STATUS_ORDER.map((status) => (
        <DueLane
          key={status}
          status={status}
          cards={[...grouped[status]].sort(byDueDateThenTitle)}
          hueFor={hueFor}
          columnNameOf={columnNameOf}
        />
      ))}
    </>
  );
}

/** Soonest deadline first; undated cards last, then alphabetical for stability. */
function byDueDateThenTitle(a: BoardCard, b: BoardCard): number {
  if (a.dueDate && b.dueDate) {
    const diff = a.dueDate.getTime() - b.dueDate.getTime();
    if (diff !== 0) return diff;
  } else if (a.dueDate !== b.dueDate) {
    return a.dueDate ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}

function DueLane({
  status,
  cards,
  hueFor,
  columnNameOf,
}: {
  status: DueStatus;
  cards: BoardCard[];
  hueFor: (columnId: string) => BadgeColor;
  columnNameOf: Map<string, string>;
}) {
  const droppable = DUE_STATUS_DROPPABLE[status];
  const { setNodeRef, isOver } = useDroppable({
    id: `due:${status}`,
    disabled: !droppable,
    data: { type: "dueLane", dueStatus: status },
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="due-lane"
      data-due-status={status}
      className={`flex max-h-full w-72 shrink-0 flex-col gap-3 rounded-xl border bg-surface p-3 shadow-sm ${
        isOver && droppable
          ? "border-primary ring-2 ring-ring"
          : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 px-1">
        <span
          aria-hidden
          className={`size-2.5 shrink-0 rounded-full ${HUE_DOT[DUE_HUE[status]]}`}
        />
        <h2 className="flex-1 truncate text-sm font-semibold tracking-tight">
          {DUE_STATUS_LABEL[status]}
        </h2>
        <Badge color={DUE_HUE[status]}>{cards.length}</Badge>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto">
        {cards.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Nothing here.
          </p>
        ) : (
          cards.map((card) => (
            <DraggableCard
              key={card.id}
              card={card}
              hue={hueFor(card.columnId)}
              tag={columnNameOf.get(card.id) ?? ""}
            />
          ))
        )}
      </div>

      {!droppable ? (
        // Overdue is a source, not a target: a card becomes late on its own, so
        // there is nothing coherent for a drop here to mean.
        <p className="px-1 pb-1 text-center text-[11px] text-muted-foreground">
          Cards arrive here on their own
        </p>
      ) : null}
    </div>
  );
}

function DraggableCard({
  card,
  hue,
  tag,
}: {
  card: BoardCard;
  hue: BadgeColor;
  tag: string;
}) {
  const openCard = React.useContext(OpenCardContext);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { type: "card" },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      data-testid="board-card"
      data-card-title={card.title}
      {...attributes}
      {...listeners}
      onClick={() => openCard(card.id)}
    >
      <TaskCardShell card={card} hue={hue} tag={tag} showSchedule />
    </div>
  );
}

/** Per-card date/pause controls, hidden from viewers. */
function CardScheduleIfEditable({ card }: { card: BoardCard }) {
  const canEdit = React.useContext(CanEditContext);
  if (!canEdit) return null;
  return (
    <CardContent className="p-0 pt-3">
      <CardSchedule
        cardId={card.id}
        dueDate={card.dueDate}
        paused={Boolean(card.pausedAt)}
      />
    </CardContent>
  );
}

/** The add-card affordance, or nothing at all for a viewer. */
function AddCardOrNothing({ columnId }: { columnId: string }) {
  const canEdit = React.useContext(CanEditContext);
  return canEdit ? <AddCardForm columnId={columnId} /> : null;
}

/** Lane accents: urgency reads as colour without needing to read the heading. */
const DUE_HUE: Record<DueStatus, BadgeColor> = {
  overdue: "rose",
  dueNow: "amber",
  later: "blue",
  paused: "slate",
  completed: "green",
};

const PRIORITY_LABEL = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
} as const;

/** Urgent and High share the alarm colours; Low stays quiet on purpose. */
const PRIORITY_HUE = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "rose",
} as const satisfies Record<string, BadgeColor>;

// ── Sortable wrappers ────────────────────────────────────────────────────────

function SortableColumn({
  column,
  hue,
}: {
  column: ColumnWithCards;
  hue: BadgeColor;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id, data: { type: "column" } });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ColumnShell
        column={column}
        hue={hue}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function SortableCard({
  card,
  hue,
  tag,
}: {
  card: BoardCard;
  hue: BadgeColor;
  tag: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card", columnId: card.columnId } });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const openCard = React.useContext(OpenCardContext);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="board-card"
      data-card-title={card.title}
      {...attributes}
      {...listeners}
      // A click and a drag are distinguishable here: PointerSensor only activates
      // after 6px of movement, so a click that never moves never becomes a drag
      // and this fires cleanly.
      onClick={() => openCard(card.id)}
    >
      <TaskCardShell card={card} hue={hue} tag={tag} />
    </div>
  );
}

// ── Presentational shells (styling ported from the previous server view) ─────

function ColumnShell({
  column,
  hue,
  handleProps,
  dragging,
}: {
  column: ColumnWithCards;
  hue: BadgeColor;
  handleProps?: React.HTMLAttributes<HTMLElement>;
  dragging?: boolean;
}) {
  return (
    <div
      data-testid="board-column"
      data-column-name={column.name}
      className={`flex max-h-full w-72 shrink-0 flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm ${
        dragging ? "shadow-lg" : ""
      }`}
    >
      <div
        {...handleProps}
        className={`flex items-center gap-2 px-1 ${
          handleProps ? "cursor-grab touch-none active:cursor-grabbing" : ""
        }`}
      >
        <span
          aria-hidden
          className={`size-2.5 shrink-0 rounded-full ${HUE_DOT[hue]}`}
        />
        <h2 className="flex-1 truncate text-sm font-semibold tracking-tight">
          {column.name}
        </h2>
        <Badge color={hue}>{column.cards.length}</Badge>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto">
        <SortableContext
          items={column.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.cards.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No cards yet.
            </p>
          ) : (
            column.cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                hue={hue}
                tag={column.name}
              />
            ))
          )}
        </SortableContext>
      </div>

      <AddCardOrNothing columnId={column.id} />
    </div>
  );
}

function TaskCardShell({
  card,
  hue,
  tag,
  dragging,
  showSchedule,
}: {
  card: BoardCard;
  hue: BadgeColor;
  tag: string;
  dragging?: boolean;
  /** Render the date/pause controls. On in the schedule view, off in columns. */
  showSchedule?: boolean;
}) {
  const blockedByOpen = card.blockedBy.filter(
    (block) => !block.blocker.completedAt,
  ).length;

  return (
    <Card
      className={`p-4 transition-shadow hover:shadow-md ${
        dragging ? "cursor-grabbing shadow-lg" : "cursor-grab"
      }`}
    >
      <CardHeader className="p-0">
        <CardTitle className="text-sm">{card.title}</CardTitle>
      </CardHeader>
      {card.description ? (
        <CardContent className="p-0 pt-2">
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {card.description}
          </p>
        </CardContent>
      ) : null}
      <CardContent className="flex flex-wrap items-center gap-2 p-0 pt-3">
        <Badge color={hue}>{tag}</Badge>
        {/* Priority first: it is what the eye should catch when triaging. */}
        {card.priority ? (
          <Badge color={PRIORITY_HUE[card.priority]} data-testid="card-priority">
            {PRIORITY_LABEL[card.priority]}
          </Badge>
        ) : null}
        {card.category ? (
          <Badge color="violet" data-testid="card-category">
            {card.category}
          </Badge>
        ) : null}
        {/* A due date is worth seeing in the column view too — it is the reason a
            card will show up in Overdue tomorrow. */}
        {card.dueDate ? (
          <span
            data-testid="card-due"
            className="text-xs text-muted-foreground"
          >
            Due {dayKeyOfDueDate(card.dueDate)}
          </span>
        ) : null}
        {card.completedAt ? <Badge color="green">Done</Badge> : null}
        {card.pausedAt ? (
          <Badge color="slate">Paused</Badge>
        ) : null}
      </CardContent>

      {(card.owner || card.checklist.length > 0 || blockedByOpen > 0) ? (
        <CardContent className="flex flex-wrap items-center gap-3 p-0 pt-2 text-xs text-muted-foreground">
          {card.owner ? <span data-testid="card-owner">{card.owner}</span> : null}
          {card.checklist.length > 0 ? (
            <span data-testid="card-checklist">
              ☑ {card.checklist.filter((i) => i.done).length}/
              {card.checklist.length}
            </span>
          ) : null}
          {/* Only unfinished blockers are worth flagging — once they are done the
              card is no longer waiting on anything. */}
          {blockedByOpen > 0 ? (
            <span data-testid="card-blocked" className="text-destructive">
              ⛔ Blocked by {blockedByOpen}
            </span>
          ) : null}
        </CardContent>
      ) : null}
      {showSchedule && !dragging ? <CardScheduleIfEditable card={card} /> : null}
    </Card>
  );
}

// Column ↔ card hue. Well-known column names get a meaningful, stable hue;
// anything else cycles the palette by position so every column still gets a
// distinct accent. A column and its cards render the same hue, keeping status
// and schedule visually paired.
const PALETTE: BadgeColor[] = ["slate", "blue", "amber", "violet", "green", "rose"];

const NAMED_HUES: Record<string, BadgeColor> = {
  backlog: "slate",
  "to do": "blue",
  todo: "blue",
  "in progress": "amber",
  doing: "amber",
  review: "violet",
  "in review": "violet",
  done: "green",
  complete: "green",
  completed: "green",
  blocked: "rose",
};

function columnHue(name: string, index: number): BadgeColor {
  return (
    NAMED_HUES[name.trim().toLowerCase()] ?? PALETTE[index % PALETTE.length]
  );
}

// Static class map so Tailwind can see each literal utility (dynamic
// `bg-label-${hue}` strings would be purged).
const HUE_DOT: Record<BadgeColor, string> = {
  slate: "bg-label-slate",
  blue: "bg-label-blue",
  amber: "bg-label-amber",
  green: "bg-label-green",
  rose: "bg-label-rose",
  violet: "bg-label-violet",
};
