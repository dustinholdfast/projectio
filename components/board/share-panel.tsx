"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Dialog, Label, Select } from "@/components/ui";
import {
  createShareLink,
  type CreatedShareLink,
  removeMember,
  revokeShareLink,
  setMemberRole,
} from "@/lib/actions/sharing";
import { ROLE_DESCRIPTION, ROLE_LABEL, type BoardRole } from "@/lib/roles";
import type { BoardMemberSummary, ShareLinkSummary } from "@/lib/board";

// Owner-only sharing panel: who has access, and the links that grant it.
//
// The two lists are deliberately separate. Revoking a link does not remove
// anyone who already used it — by then they are a member in their own right —
// and presenting them as one list would imply otherwise.

export function SharePanel({
  boardId,
  boardName,
  members,
  links,
}: {
  boardId: string;
  boardName: string;
  members: BoardMemberSummary[];
  links: ShareLinkSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();

  const shared = members.length > 1;

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

  const now = Date.now();
  const activeLinks = links.filter(
    (link) => !link.revokedAt && new Date(link.expiresAt).getTime() > now,
  );

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Share
        {shared ? (
          <Badge color="blue" className="ml-2">
            {members.length}
          </Badge>
        ) : null}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Share “{boardName}”</h2>
              <p className="text-sm text-muted-foreground">
                Anyone with an active link can join at the role it grants.
              </p>
            </div>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">People with access</h3>
            <ul className="flex flex-col gap-2">
              {members.map((member) => (
                <li
                  key={member.userId}
                  data-testid="board-member"
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate text-sm">
                    {member.name ?? member.email}
                    {member.isYou ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>

                  {member.role === "OWNER" ? (
                    <Badge color="violet">Owner</Badge>
                  ) : (
                    <>
                      <Select
                        aria-label={`Role for ${member.email}`}
                        value={member.role}
                        disabled={isPending}
                        className="h-8 w-28"
                        onChange={(event) =>
                          run(() =>
                            setMemberRole({
                              boardId,
                              userId: member.userId,
                              role: event.target.value as BoardRole,
                            }),
                          )
                        }
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="EDITOR">Editor</option>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        aria-label={`Remove ${member.email}`}
                        onClick={() =>
                          run(() => removeMember({ boardId, userId: member.userId }))
                        }
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Share links</h3>

            {activeLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active links. Anyone you have already shared with keeps access.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {activeLinks.map((link) => (
                    <li
                      key={link.id}
                      data-testid="share-link"
                      className="flex items-center gap-2"
                    >
                      <Badge color={link.role === "EDITOR" ? "amber" : "slate"}>
                        {ROLE_LABEL[link.role]}
                      </Badge>
                      <span className="flex-1 text-xs text-muted-foreground">
                        Link {link.tokenPrefix}â€¦ Â· expires{" "}
                        {new Date(link.expiresAt).toISOString().slice(0, 10)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        aria-label="Revoke link"
                        onClick={() => run(() => revokeShareLink({ linkId: link.id }))}
                      >
                        Revoke
                      </Button>
                    </li>
                ))}
              </ul>
            )}

            <CreateLink boardId={boardId} disabled={isPending} onError={setError} />

            <p className="text-xs text-muted-foreground">
              Revoking a link stops new people joining with it. It does not remove
              anyone who already has access — use the list above for that.
            </p>
          </section>
        </div>
      </Dialog>
    </>
  );
}

function CreateLink({
  boardId,
  disabled,
  onError,
}: {
  boardId: string;
  disabled: boolean;
  onError: (message?: string) => void;
}) {
  const router = useRouter();
  const [role, setRole] = React.useState<BoardRole>("VIEWER");
  const [expirationDays, setExpirationDays] = React.useState("7");
  const [created, setCreated] = React.useState<CreatedShareLink>();
  const [copied, setCopied] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
        <Label htmlFor={`new-link-role-${boardId}`}>New link grants</Label>
        <Select
          id={`new-link-role-${boardId}`}
          value={role}
          disabled={disabled || isPending}
          className="w-32"
          onChange={(event) => setRole(event.target.value as BoardRole)}
        >
          <option value="VIEWER">Viewer</option>
          <option value="EDITOR">Editor</option>
        </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`new-link-expiration-${boardId}`}>Expires after</Label>
          <Select
            id={`new-link-expiration-${boardId}`}
            value={expirationDays}
            disabled={disabled || isPending}
            className="w-28"
            onChange={(event) => setExpirationDays(event.target.value)}
          >
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </Select>
        </div>
      <Button
        type="button"
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            const data = new FormData();
            data.append("boardId", boardId);
            data.append("role", role);
            data.append("expirationDays", expirationDays);
            const result = await createShareLink(undefined, data);
            if (result && "error" in result) {
              onError(result.error);
              return;
            }
            if (result && "created" in result) {
              setCreated(result.created);
              setCopied(false);
            }
            onError(undefined);
            router.refresh();
          })
        }
      >
        {isPending ? "Creating…" : "Create link"}
      </Button>
      <p className="pb-2 text-xs text-muted-foreground">
        {ROLE_DESCRIPTION[role]}
      </p>
      </div>

      {created ? (
        <div
          data-testid="new-share-link"
          className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Copy this link now</p>
            <code className="block truncate text-xs">
              {`/join/${created.token}`}
            </code>
            <p className="text-xs text-muted-foreground">
              It cannot be shown again after this panel closes.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const path = `/join/${created.token}`;
              navigator.clipboard.writeText(
                new URL(path, window.location.origin).toString(),
              );
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
