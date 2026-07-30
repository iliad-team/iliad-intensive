/**
 * The "in flight" tint — a sixth tone for /admin/status, alongside the five in
 * page.tsx that the build derives. Deliberately not the sky `ok` tone: "in hand
 * but not ours to build" and "a branch exists that hasn't merged" are different
 * claims and shouldn't share a colour.
 *
 * In its own module, with no "use client", because BOTH sides need it: the
 * client chip (components/InFlight.tsx) and the server-rendered legend
 * (app/admin/status/page.tsx). It cannot live in InFlight.tsx — Next replaces a
 * "use client" module's exports with client references on the server side, so a
 * server component importing this from there gets `undefined`, and the legend
 * silently renders `class="rounded px-2 py-1 undefined"` with an empty glyph.
 * That compiles and type-checks cleanly, so it is only visible in the output.
 */
export const FLIGHT = {
  cell: "bg-violet-600 text-white",
  chip: "border-violet-300",
  glyph: "⇡",
} as const;
