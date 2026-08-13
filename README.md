# Copy Component

A Sitecore XM Cloud **Marketplace app** that copies a component from the page an
author is editing onto other pages — bringing its local datasources along, and
leaving shared ones shared.

It runs as a **Pages context panel**, with no backend and no stored credentials.

---

## Why a panel and not a button on the component

The original ask was a "Copy to another page" button on each component's
toolbar. The Marketplace SDK does not expose that surface. As of
`@sitecore-marketplace-sdk/client` 0.2.x the only app types are:

```ts
export type AppType = 'portal' | 'xmc:xmapps' | 'xmc:pages-contextview';
```

There is no rendering-chrome extension point, and `pages.context` reports the
current **page** but not the currently **selected rendering**. So the panel asks
"which component" explicitly, listing what is on the page grouped by
placeholder. It is one click away from the component instead of on it.

## What it does

1. Reads the current page's resolved layout from `pages.context`.
2. Lists its components, with nested-child counts, so picking a container is an
   informed choice.
3. Lets the author pick one or more target pages within the same site.
4. Asks, per target page, whether to use the **same placeholder key** or pick a
   different one — same key is offered only when the target actually has it.
5. Copies, appending after whatever is already in the chosen placeholder.

### Datasources

| Datasource | What happens |
| --- | --- |
| Page-relative (`local:/Data/Promo`) | The form XM Cloud actually writes. Local by definition — the prefix means "under the page rendering this". Deep-copied to the same relative path under the target, and the value is left page-relative so it resolves against the target's own copy. |
| Under the page by path or id (`<page>/Data/…`) | Deep-copied to the same relative path under the target page. `Data` folder created if missing (see below). Name collisions are suffixed (`Promo` → `Promo-1`), never overwritten. |
| Anywhere else | Left alone — the copy points at the same shared item. |
| `query:` / `$token` | Left alone. These resolve per-page at render time; copying what they currently point at would be wrong. |
| Empty | Nothing to do. |

Two renderings pointing at the same local datasource produce **one** copy that
both point at.

Every datasource produces a line in the result, including the ones deliberately
left alone. "Shared, on purpose" and "I could not resolve this, so I left it"
look identical in the copied page but mean very different things — and a silent
skip once hid a real bug for a whole release. Unresolvable ones are flagged.

**`local:` is a datasource scheme, not a path.** XM Cloud stores a page's own
datasources as `local:/Data/Promo` — resolved against whichever page renders
the component. Treating that as an ordinary path classified the *most* local
kind of datasource as shared and skipped it. Two consequences worth knowing:
the copy source has to be resolved against the source page before `copyItem`
can take it, and the stored value is deliberately left page-relative afterwards
so it points at the target's own copy with no rewriting — except when a name
collision renamed the copy, which is the one case the value must be rebuilt.

**Guid variables must be declared `ID`, not `String`.** `ItemQueryInput.itemId`
is typed `ID`, and a variable declared `String!` fails GraphQL *variable
validation* before the query runs. That produced no item rather than an obvious
error, so every datasource silently reclassified as shared and was skipped —
the single bug behind "the component copies but its datasource doesn't". The
same mismatch was leaving every component labelled "Component" in the picker.

`src/lib/copy/local-items.ts` walks *down* from the page with
`children { nodes }` and is kept as a fallback for when an id lookup returns
nothing, built lazily so the common path stays one query. Child pages are
skipped: their datasources are their own, and descending would walk the site.

### The `Data` folder

Target pages often don't have one yet. When it's missing it is created from
SXA's local-datasource template:

```
/sitecore/templates/Foundation/Experience Accelerator/Local Datasources/Page Data
{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}
```

A plain `Common/Folder` renders identically in the content tree but SXA does
not treat it as page data, so getting this wrong fails silently and late. The
source page's own folder template is mirrored when it can be read — a site
using a custom local-datasource template keeps it — and Page Data is the
fallback. The result line names which template was used.

### Containers

Picking a container copies the whole nest. Descendants are found by **uid
reachability** — a nested placeholder key embeds its parent rendering's uid — so
it survives the several key formats SXA and JSS have emitted, and a sibling
whose key merely shares a text prefix is correctly left out.

Every copied instance gets a **fresh uid**, and nested placeholder keys are
rewritten to point at the new parent uids.

## Design decisions worth knowing

**Writes are appends to the `__Final Renderings` delta.** That field holds an
XML *patch* against the shared layout, not a standalone document. Appending a
`<r>` element adds a rendering while the page keeps inheriting its
standard-values presentation. Flattening the resolved layout into the field
would also "work" and would quietly sever that inheritance, so the code never
does it — see `src/lib/layout/layout-xml.ts`.

**Personalization and caching flags are not carried over.** Personalization
rules reference the source page's own datasources and variants; silently
copying a rule set that no longer resolves is worse than leaving the copy
unpersonalized. Rendering **parameters** *are* copied.

**Current language and latest version only.** The copy lands in the language the
author is editing.

**No transaction.** Sitecore gives us none across pages, so targets are
processed independently and each reports its own outcome. A failure on page
three leaves pages one and two copied and says so.

**The layout is resolved client-side.** The Authoring API exposes no
pre-resolved layout — there is no `presentationDetails` field on `Item`, and
asking for one fails the whole query. So the two stored fields are read
directly and merged in `src/lib/layout/merge.ts`: `__Renderings` is the base
(already inherited through standard values by the field read) and
`__Final Renderings` is a patch on top. A patch entry may carry only the
attributes that changed, so attributes are overlaid one at a time — swapping
whole entries would read an unchanged datasource as empty.

**Placeholder list = placeholders in use.** Sitecore only records a placeholder
once something sits in it, so a target page with an empty placeholder cannot
advertise it. When a target has no components at all, the copy uses the source
key.

## Setup

Marketplace app configuration:

- **App type:** Pages context panel (`xmc:pages-contextview`)
- **API access:** *Authoring and Management GraphQL API* — required; every call
  goes through `xmc.authoring.graphql`
- **Deployment URL:** wherever this is hosted

The host mints the token for the signed-in author, so the app can only ever do
what that author could do by hand in Pages.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

Opened outside the Pages iframe, the panel says so rather than spinning — the
SDK handshake targets `window.parent` and has nothing to talk to. Note that
`ClientSDK.init` stops retrying after five attempts but leaves its promise
*pending* rather than rejecting, so the app imposes its own 15-second deadline
(`src/lib/marketplace/with-timeout.ts`). Without it the panel shows
"Connecting to Pages…" forever.

## Layout

```
src/lib/layout/     presentation parsing, __Final Renderings XML, placeholder keys
src/lib/copy/       datasource rules, the executor, site-root resolution
src/lib/marketplace/ SDK client, pages.context subscription, Authoring GraphQL
src/components/     the panel's four steps
```

The pure logic in `src/lib/` is unit-tested; the Authoring API is stubbed in
`src/lib/copy/execute.test.ts`.

## Schema check

The panel has a **Schema check** section on the results step. It runs GraphQL
introspection against the tenant and prints what `ItemQueryInput` accepts and
what the item mutations look like. It exists because the Authoring schema is
the one thing this app cannot see from the outside — three assumptions about it
were wrong, each costing a deploy to discover. When a copy misbehaves in a way
the error does not explain, run it and read the real field list.

## Known gaps

- **Write mutations still unproven end to end.** The schema is now known from
  introspection against a real tenant rather than guessed, and the input shapes
  match it. `updateItem` layout writes are confirmed working. `copyItem` and
  `createItem` are built to the tenant's own `CopyItemInput` / `CreateItemInput`
  but have not yet completed a successful run.
- Child listings fetch the first 100 items per level. A page tree wider than
  that will not show every sibling in the picker, and a `Data` folder holding
  more than 100 items could be given a duplicate name rather than a suffixed
  one. Both need paging if they show up in practice.
- Cross-site and cross-environment copying are out of scope.
- No publish step — copies land in `master` for the author to review.
