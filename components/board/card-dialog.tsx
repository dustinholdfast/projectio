"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  Badge,
  Button,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import {
  addCardBlocker,
  addChecklistItem,
  deleteCard,
  deleteChecklistItem,
  removeCardBlocker,
  setChecklistItemDone,
  updateCardDetails,
} from "@/lib/actions/card-details";
import { dayKeyOfDueDate } from "@/lib/due-status";
import type { BoardCard, ColumnWithCards } from "@/lib/board";

// The card detail dialog: every field that does not fit on the card face.
//
// The detail fields save as one form, because they are edited together and a
// per-field autosave would fire a request per keystroke on the notes box. The
// checklist and blocker lists save immediately, because each interaction there
// is already a discrete decision (ticked, added, removed) with nothing to
// "cancel" back to.

const PRIORITY_OPTIONS = [
  { value: "", label: "None" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
] as const;

function dateValue(date: Date | null): string {
  return date ? dayKeyOfDueDate(date) : "";
}

export function CardDialog({
  card,
  columns,
  onClose,
}: {
  card: BoardCard;
  /** Every column on the board, for the blocker picker and the category list. */
  columns: ColumnWithCards[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();
  const titleId = `card-dialog-${card.id}`;

  const allCards = React.useMemo(
    () => columns.flatMap((column) => column.cards),
    [columns],
  );

  // Existing categories on this board, offered as suggestions. Free text stays
  // free — this only saves retyping and reduces near-duplicate categories.
  const categories = React.useMemo(
    () =>
      Array.from(
        new Set(
          allCards
            .map((c) => c.category)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
    [allCards],
  );

  const blockerIds = new Set(card.blockedBy.map((b) => b.blockerId));
  const blockerCandidates = allCards.filter(
    (candidate) => candidate.id !== card.id && !blockerIds.has(candidate.id),
  );

  // Ticking a box should feel instant. Without this the checkbox stays visually
  // unchanged until the server round-trip and revalidation land, which reads as
  // a broken control rather than a slow one.
  const [checklist, applyOptimisticTick] = React.useOptimistic(
    card.checklist,
    (items, update: { id: string; done: boolean }) =>
      items.map((item) =>
        item.id === update.id ? { ...item, done: update.done } : item,
      ),
  );

  const done = checklist.filter((item) => item.done).length;

  function run(action: () => Promise<{ error: string } | undefined>) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId}>
      <form
        className="flex flex-col gap-5 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await updateCardDetails(undefined, formData);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(undefined);
            onClose();
          });
        }}
      >
        <input type="hidden" name="cardId" value={card.id} />

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label htmlFor={`${titleId}-title`}>Title</Label>
            <Input
              id={`${titleId}-title`}
              name="title"
              defaultValue={card.title}
              maxLength={120}
              required
              className="mt-1.5 text-base font-medium"
            />
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {/* Names the dialog for assistive tech without duplicating the title. */}
        <span id={titleId} className="sr-only">
          Card details: {card.title}
        </span>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-owner`}>Owner</Label>
            <Input
              id={`${titleId}-owner`}
              name="owner"
              defaultValue={card.owner ?? ""}
              placeholder="Who is responsible?"
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-category`}>Category</Label>
            <Input
              id={`${titleId}-category`}
              name="category"
              defaultValue={card.category ?? ""}
              list={`${titleId}-categories`}
              placeholder="e.g. Design, Backend"
              maxLength={120}
            />
            <datalist id={`${titleId}-categories`}>
              {categories.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-priority`}>Priority</Label>
            <Select
              id={`${titleId}-priority`}
              name="priority"
              defaultValue={card.priority ?? ""}
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-due`}>Due date</Label>
            <Input
              id={`${titleId}-due`}
              name="dueDate"
              type="date"
              defaultValue={dateValue(card.dueDate)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-started`}>Date started</Label>
            <Input
              id={`${titleId}-started`}
              name="startedAt"
              type="date"
              defaultValue={dateValue(card.startedAt)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${titleId}-completed`}>Date completed</Label>
            <Input
              id={`${titleId}-completed`}
              name="completedAt"
              type="date"
              defaultValue={dateValue(card.completedAt)}
            />
            <p className="text-xs text-muted-foreground">
              Setting this moves the card to Completed in the schedule view.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${titleId}-description`}>Description</Label>
          <Textarea
            id={`${titleId}-description`}
            name="description"
            defaultValue={card.description ?? ""}
            rows={2}
            placeholder="Short summary, shown on the card"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${titleId}-notes`}>Notes</Label>
          <Textarea
            id={`${titleId}-notes`}
            name="notes"
            defaultValue={card.notes ?? ""}
            rows={6}
            placeholder="Long-form detail — never shown on the board face"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>

      {/* Checklist and blockers sit outside the form: they save on interaction,
          and nesting them would make Enter in their inputs submit the form. */}
      <section className="flex flex-col gap-3 border-t border-border p-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Checklist</h3>
          {checklist.length > 0 ? (
            <Badge color={done === checklist.length ? "green" : "slate"}>
              {done}/{checklist.length}
            </Badge>
          ) : null}
        </div>

        <ul className="flex flex-col gap-1.5">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                aria-label={item.text}
                onChange={(event) => {
                  const next = event.target.checked;
                  startTransition(async () => {
                    // Optimistic first, then persist. The update must happen
                    // inside the transition or React discards it.
                    applyOptimisticTick({ id: item.id, done: next });
                    const result = await setChecklistItemDone({
                      itemId: item.id,
                      done: next,
                    });
                    if (result?.error) {
                      setError(result.error);
                      return;
                    }
                    setError(undefined);
                    router.refresh();
                  });
                }}
                className="size-4 accent-[var(--color-primary)]"
              />
              <span
                className={`flex-1 text-sm ${
                  item.done ? "text-muted-foreground line-through" : ""
                }`}
              >
                {item.text}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                aria-label={`Remove ${item.text}`}
                onClick={() => run(() => deleteChecklistItem({ itemId: item.id }))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <AddChecklistItem cardId={card.id} disabled={isPending} onDone={run} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border p-6">
        <h3 className="text-sm font-semibold">Blocked by</h3>

        {card.blockedBy.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is blocking this card.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {card.blockedBy.map((block) => (
              <li key={block.blockerId} className="flex items-center gap-2">
                <span className="flex-1 text-sm">
                  {block.blocker.title}
                  {block.blocker.completedAt ? (
                    <Badge color="green" className="ml-2">
                      Done
                    </Badge>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  aria-label={`Unblock from ${block.blocker.title}`}
                  onClick={() =>
                    run(() =>
                      removeCardBlocker({
                        blockedId: card.id,
                        blockerId: block.blockerId,
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {blockerCandidates.length > 0 ? (
          <AddBlocker
            cardId={card.id}
            candidates={blockerCandidates}
            disabled={isPending}
            onDone={run}
          />
        ) : null}
      </section>

      <section className="border-t border-border p-6">
        <DeleteCard
          card={card}
          // Cards waiting on this one, counted from the board we already have
          // rather than with another query.
          dependents={allCards.filter((other) =>
            other.blockedBy.some((block) => block.blockerId === card.id),
          )}
          disabled={isPending}
          onDeleted={onClose}
        />
      </section>
    </Dialog>
  );
}

/**
 * Delete, behind a confirm that states the consequences.
 *
 * The cascade is the reason for the wording: checklist items go, and so do the
 * dependency links in both directions — which means other cards silently stop
 * being blocked. That is invisible from here, so the confirm names it.
 */
function DeleteCard({
  card,
  dependents,
  disabled,
  onDeleted,
}: {
  card: BoardCard;
  dependents: BoardCard[];
  disabled: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [isDeleting, startDeleting] = React.useTransition();

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Deleting a card cannot be undone.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          Delete card
        </Button>
      </div>
    );
  }

  const consequences = [
    card.checklist.length > 0
      ? `${card.checklist.length} checklist item${card.checklist.length === 1 ? "" : "s"}`
      : null,
    dependents.length > 0
      ? `${dependents.length} card${dependents.length === 1 ? "" : "s"} waiting on it will be unblocked`
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Delete “{card.title}”?</p>
        {consequences.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            This also removes {consequences.join(", and ")}.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={isDeleting}
          onClick={() =>
            startDeleting(async () => {
              const result = await deleteCard({ cardId: card.id });
              if (result?.error) {
                setError(result.error);
                return;
              }
              // Close first: the card this dialog is showing no longer exists.
              onDeleted();
              router.refresh();
            })
          }
        >
          {isDeleting ? "Deleting…" : "Delete card"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isDeleting}
          onClick={() => {
            setConfirming(false);
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddChecklistItem({
  cardId,
  disabled,
  onDone,
}: {
  cardId: string;
  disabled: boolean;
  onDone: (action: () => Promise<{ error: string } | undefined>) => void;
}) {
  const [text, setText] = React.useState("");

  return (
    <div className="flex items-center gap-2">
      <Input
        value={text}
        disabled={disabled}
        placeholder="Add an item"
        aria-label="New checklist item"
        maxLength={120}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (!text.trim()) return;
          onDone(() => addChecklistItem({ cardId, text }));
          setText("");
        }}
      />
      <Button
        type="button"
        disabled={disabled || !text.trim()}
        onClick={() => {
          onDone(() => addChecklistItem({ cardId, text }));
          setText("");
        }}
      >
        Add
      </Button>
    </div>
  );
}

function AddBlocker({
  cardId,
  candidates,
  disabled,
  onDone,
}: {
  cardId: string;
  candidates: BoardCard[];
  disabled: boolean;
  onDone: (action: () => Promise<{ error: string } | undefined>) => void;
}) {
  const [selected, setSelected] = React.useState("");

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selected}
        disabled={disabled}
        aria-label="Card that blocks this one"
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Choose a card…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        disabled={disabled || !selected}
        onClick={() => {
          onDone(() =>
            addCardBlocker({ blockedId: cardId, blockerId: selected }),
          );
          setSelected("");
        }}
      >
        Add
      </Button>
    </div>
  );
}
