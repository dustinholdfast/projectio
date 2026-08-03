# UI Spec — Task Board Design Direction

Authored for the "Design Direction" phase. Establishes the visual language and
the reusable component system used by every screen that follows (auth, board).
Live reference page: **`/design`** (`app/design/page.tsx`).

## Direction — "Calm Focus"

A quiet, productivity-tool aesthetic. Neutral slate surfaces, generous
whitespace, soft borders and shadows, and a single indigo accent so the eye
lands on the work — not the chrome. Full light + dark support via a class-based
`.dark` toggle, so the app can offer a manual theme switch.

## Tokens (source of truth: `app/globals.css`)

Tokens are CSS variables mapped into Tailwind's theme via `@theme inline`, so
they are consumed as **semantic utilities**, never as raw hex:

| Concern      | Tokens (utility form)                                                        |
| ------------ | --------------------------------------------------------------------------- |
| Surfaces     | `bg-background`, `bg-surface` (columns), `bg-card` (task cards)              |
| Text         | `text-foreground`, `text-muted-foreground`, `text-card-foreground`          |
| Muted/hover  | `bg-muted`, `bg-accent` / `text-accent-foreground`                          |
| Lines/focus  | `border-border`, `border-input`, `ring-ring`                                |
| Brand        | `bg-primary` / `text-primary-foreground`, `hover:bg-primary-hover`          |
| Feedback     | `bg-destructive`, `text-success`, `text-warning`                            |
| Board labels | `bg-label-{slate,blue,amber,green,rose,violet}` + matching `-soft` fills     |
| Radius       | `rounded-sm/md/lg/xl` (base `--radius` = 10px)                               |
| Elevation    | `shadow-sm` (cards), `shadow-md` (popovers), `shadow-lg` (drag/overlay)      |

**Board label palette** is shared: a card's tag and its column accent reference
the same hue name, keeping status and schedule from drifting apart. Suggested
column mapping: Backlog=slate, To Do=blue, In Progress=amber, Review=violet,
Done=green, Blocked=rose.

### Dark mode

`@custom-variant dark (&:is(.dark *))` — add/remove `.dark` on `<html>`. Every
token has a dark value, so components need no `dark:` overrides; they read
semantic tokens and adapt automatically.

## Typography & spacing

- Font: system UI sans stack (`--font-sans`), antialiased.
- Headings: `font-semibold tracking-tight`; section eyebrows: `text-xs uppercase
  tracking-wider text-muted-foreground`.
- Body/controls: `text-sm`; meta/labels: `text-xs`.
- Spacing rhythm on the 4px grid (`gap-2/3/4`, `p-3/4`). Columns pad `p-3`,
  cards `p-4`.

## Component system (`components/ui`, import from `@/components/ui`)

Headless-ish primitives: each forwards refs, spreads native props, and takes a
`className` merged via `cn()` (`lib/utils.ts` = clsx + tailwind-merge) so callers
override without specificity fights.

- **Button** — variants `primary | secondary | outline | ghost | destructive`;
  sizes `sm | md | lg | icon`. Focus-visible ring on all.
- **Input** / **Label** — form controls for auth and inline card/column editors.
- **Card** (+ `CardHeader/Title/Description/Content/Footer`) — the surface task
  cards, auth panels, and popovers compose from.
- **Badge** — status/label chip, `color` ∈ the board palette.

## Contract for downstream work

- **Coder** builds structure/behavior by composing these primitives and semantic
  tokens; keep bespoke styling minimal.
- **Restyle cards** (auth, board) adjust presentation by tuning **token values in
  `globals.css`** or primitive classes — not by hardcoding colors in screens.
- Add new primitives to `components/ui` with the same ref/className/token
  conventions rather than one-off styled markup.
