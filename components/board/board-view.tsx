"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
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
import { reorderCard, reorderColumn } from "@/lib/actions/board";
import { planCardMove, planColumnMove } from "@/lib/reorder";
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

export function BoardView({ board }: { board: BoardWithColumns }) {
  const router = useRouter();
  const [columns, setColumns] = React.useState<ColumnWithCards[]>(board.columns);
  const [active, setActive] = React.useState<DragKind | null>(null);
  const [, startTransition] = React.useTransition();

  // Re-sync from the server whenever a fresh board arrives (after revalidation).
  // Our optimistic state already matches a successful move, so this is a no-op in
  // the happy path and a correction if the server diverged.
  React.useEffect(() => {
    setColumns(board.columns);
  }, [board]);

  const sensors = useSensors(
    // A small activation distance lets clicks on the in-column "add card" controls
    // through instead of being swallowed as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
    if (!over) return;

    const kind = dragged.data.current?.type;

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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <section className="flex flex-1 items-start gap-4 overflow-x-auto p-4 sm:p-6">
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
        <AddColumnForm boardId={board.id} />
      </section>

      <DragOverlay>
        {active?.type === "column" ? (
          <ColumnShell column={active.column} hue={active.hue} dragging />
        ) : active?.type === "card" ? (
          <TaskCardShell card={active.card} hue={active.hue} tag={active.tag} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="board-card"
      data-card-title={card.title}
      {...attributes}
      {...listeners}
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

      <AddCardForm columnId={column.id} />
    </div>
  );
}

function TaskCardShell({
  card,
  hue,
  tag,
  dragging,
}: {
  card: BoardCard;
  hue: BadgeColor;
  tag: string;
  dragging?: boolean;
}) {
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
      <CardContent className="p-0 pt-3">
        <Badge color={hue}>{tag}</Badge>
      </CardContent>
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
