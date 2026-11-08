# Daybook: product and design spec

A calendar and a to-do list, nothing else. The to-do list always shows how long each task has been waiting.
This one spec drives both the iOS app and the website, so they feel like the same product.

Quality bar: it should look like Apple shipped it. Clean, calm, generous spacing, one accent colour, no decoration
that doesn't do a job. When in doubt, remove. Every screen must still be useful with real, messy data
(long titles, 40 tasks, five events on one day, huge Dynamic Type, dark mode).

## Where things live

| | iOS app | Website |
|---|---|---|
| Folder | `~/Developer/Daybook` | `~/daybook-web` (the site itself in `docs/`) |
| GitHub | `brucesweater/daybook-ios` (private) | `brucesweater/daybook` (public) |
| Stack | SwiftUI, no third-party packages | Plain HTML, CSS, ES modules. No framework, no build step, no external requests of any kind |
| Runs at | Xcode scheme `Daybook`, bundle `com.brucegao.daybook`, team `V285DXY77R`, automatic signing, iOS 17.0+, iPhone portrait, iPad all orientations | `https://brucesweater.github.io/daybook/` via GitHub Pages from `main:/docs` |

Do not touch git or GitHub; publishing happens after the build. Do leave a good `.gitignore`.

## Screens and behaviour (both products)

### Calendar

- Header: month and year, big: **November** 2026 (month bold, year regular in secondary colour). Controls: previous and next month, **Today**, and a round **+** for a new event.
- Grid: 7 columns, always 6 rows, so the layout never jumps between months. Weekday letters across the top. Days from the adjacent months appear in a quieter colour and are tappable (selecting one moves to that month). First day of the week follows the user's locale.
- Today: number in the accent colour. Selected day: a filled disc behind the number (accent if the selected day is today, otherwise the primary label colour with inverted text).
- A day with at least one event shows one small dot under the number. One dot, never more, no counts.
- Changing month: swipe horizontally on touch, chevrons everywhere. After changing month, select today if that month contains today, otherwise the 1st.
- Below the grid: the selected day's agenda. Header `Today · Sunday, November 1` when it is today, otherwise `Sunday, November 1`. If empty: `No events`, quiet and centred.
- Agenda rows: a 3 pt rounded accent bar on the leading edge, title, and a time line. Order: all-day first, then by start time, then by title (English collation ignoring case, accents and width, numbers read as numbers, never the device's language, so both products order a day alike), then by id.
- Time line for an event on day D:
  - all-day: `All day`
  - starts and ends on D: `2:00 PM – 3:00 PM` (follow the user's 12/24-hour preference)
  - multi-day, D is the first day: `Starts 11:00 PM`; D is the last day: `Ends 1:00 AM`; D is in between: `All day`
- Tap a row to edit. Swipe to delete on touch; on the web also a delete button in the editor. Delete shows an undo toast (below), no confirmation dialog.
- `+` opens New Event with the selected day filled in. Default time: if the selected day is today, the next full hour for one hour (capped so it stays on that day, with the end at 23:59 if needed); otherwise 9:00 to 10:00 AM. Title field focused.

### Event editor (sheet)

Native-feeling sheet with `Cancel` on the left, title (`New Event` or `Edit Event`), and `Add` or `Save` on the right (disabled while the title is blank after trimming). Fields, grouped: Title, then All-day switch, Starts (date and, unless all-day, time), Ends (same), then Notes. For an existing event, `Delete Event` in red at the bottom.
Moving Starts past Ends pushes Ends along, keeping the duration. Moving Ends before Starts is not allowed.

### To-do

- Header: `To-Do` with a quiet count: `3 open`, or `All done` when tasks exist and none are open. Plain list.
- Sort: open tasks oldest first, so what has waited longest stays on top. New tasks land at the bottom.
- Row: a 22 pt circle (the checkbox, with at least a 44 pt tap target), title (wraps, never truncated), and under it the age line.
- **Age line is the point of this screen. Every open task always shows it, and it stays current while the app is open** (refresh at least every 30 seconds and whenever the app returns to the foreground).

  Exact wording, using elapsed = max(0, now − assignedAt), floored:

  | Elapsed | Text |
  |---|---|
  | under 1 minute | `Assigned just now` |
  | under 1 hour | `Assigned 1 minute ago`, `Assigned 12 minutes ago` |
  | under 1 day | `Assigned 1 hour ago`, `Assigned 5 hours ago` |
  | under 14 days | `Assigned 1 day ago`, `Assigned 13 days ago` (days = elapsed ÷ 24 h) |
  | under 60 days | `Assigned 2 weeks ago`, `Assigned 8 weeks ago` (days ÷ 7) |
  | under 365 days | `Assigned 2 months ago`, `Assigned 12 months ago` (days ÷ 30) |
  | otherwise | `Assigned 1 year ago`, `Assigned 3 years ago` (days ÷ 365) |

  Exactly at a boundary, use the next row (exactly 60 s is `1 minute`, exactly 14 days is `2 weeks`).

- Age colour, so stale tasks catch the eye: under 7 days secondary colour; 7 to 29 days `age-warm`; 30 days or more `age-old` (tokens below). Text weight medium for warm and old.
- Checking off: tap the circle. It fills with the accent colour and a white check draws in, the title gets a strikethrough, and a success haptic plays on iOS. After about 0.9 s the row animates into Completed. Tapping again within that time cancels it. `completedAt` is set at the tap.
- Completed: a collapsed section at the bottom, `Completed (12)` with a chevron, plus a quiet `Clear` that removes all completed tasks and offers undo. Hidden when there are none. Completed rows are newest-done first, title struck through and secondary, with the line `Done Oct 31 · took 3 days`. Duration wording: `under a minute`, `5 minutes`, `1 hour`, `3 days`, `2 weeks`, `2 months`, `1 year`, same rounding rules as the age table. Include the year in the date only if it isn't the current year. Tapping the filled circle reopens the task, keeping its original `assignedAt`.
- Adding: an `Add a task` field. iOS: a pinned bar above the tab bar (`safeAreaInset(edge: .bottom)`), which follows the keyboard. Web: an in-flow row directly after the last open task, because fixed bottom inputs fight the iOS Safari keyboard; a `+` in the To-Do header scrolls to it and focuses it. Return adds and keeps focus so several can be typed in a row. Blank input does nothing. `assignedAt` is now.
- Tap a task's text to edit: Title, Notes, Assigned (date and time, can't be in the future), `Delete Task` in red. If it has notes, show one line of them, quiet, between title and age line.
- Swipe to delete on touch, undo toast.
- Empty state: `Nothing to do` / `Add a task below.` (iOS `ContentUnavailableView`; web equivalent).

### Undo toast

Small floating capsule near the bottom: `Task deleted` or `Event deleted` or `Completed tasks cleared`, with a bold accent `Undo`. Lasts 5 s. A new toast replaces the old one. Undo restores the items exactly (same ids, same dates).

### Backup (the only "settings")

A `…` menu with `Export Backup…` and `Import Backup…` (iOS: in the To-Do toolbar; web: in the top bar, which also shows the line `Saved in this browser. Nothing is uploaded.`).
Export writes `daybook-backup-YYYY-MM-DD.json` in the format below. Import asks for confirmation (`Replace everything here with 4 events and 9 tasks from this backup?`) and replaces all data. A file that fails validation shows `This file isn’t a Daybook backup.` and changes nothing. This is also how data moves between the app and the website: **they do not sync**, and no screen may imply they do.

## Data format (shared, version 1)

This is both the on-disk format and the backup format. `Fixtures/daybook-sample.json` is the shared test fixture and both products must load it.

```json
{
  "app": "Daybook",
  "version": 1,
  "exportedAt": "2026-11-01T18:30:00.000Z",
  "events": [
    { "id": "…", "title": "Dentist", "notes": "", "allDay": false,
      "startDay": "2026-11-05", "startMinutes": 870, "endDay": "2026-11-05", "endMinutes": 930 }
  ],
  "tasks": [
    { "id": "…", "title": "Essay", "notes": "", "assignedAt": "2026-10-29T13:00:00.000Z", "completedAt": null }
  ]
}
```

Rules that exist to prevent real bugs:

- **Events are wall-clock, with no time zone.** `startDay`/`endDay` are local calendar days as `YYYY-MM-DD`, and minutes are minutes after local midnight (0 to 1439). 3 PM stays 3 PM anywhere. All-day events have `startMinutes`/`endMinutes` null or absent; readers accept both.
- **Tasks are instants.** `assignedAt`/`completedAt` are ISO 8601 UTC. Readers must accept with and without fractional seconds (Swift's stock `.iso8601` decoder fails on JavaScript's `.000Z`, so write a custom strategy). `completedAt` may be null or absent. Writers on both platforms emit fractional seconds.
- Ids are opaque strings. Swift must not use the `UUID` type for them (case is not preserved).
- An event covers day D when `startDay <= D <= effectiveEndDay`, where `effectiveEndDay` is one day before `endDay` when the event is timed, `endDay > startDay` and `endMinutes == 0`. So a party ending exactly at midnight doesn't show on the next day.
- Never do date math by adding 86400 seconds. Never parse `YYYY-MM-DD` with `new Date(string)` in JS (it's UTC and lands on the wrong day west of Greenwich). Day arithmetic goes through a small tested `CalendarDay` type or module. Format event times from minutes against a fixed non-DST reference date so DST days can't shift a label. Data dates always use the Gregorian calendar even if the device calendar is Buddhist or Japanese.
- Validation on import and on load: `app == "Daybook"`, `version == 1`, arrays present, every event has a string id and title, valid days, `endDay >= startDay`, minutes in range or missing (and if both days are equal, `endMinutes >= startMinutes`); every task has a string id, title and valid `assignedAt`. `notes` may be absent (treat as empty). Duplicate ids keep the first. Unknown extra fields are ignored. Anything else rejects the entire file, including a file that isn't UTF-8 (a UTF-8 byte order mark is fine) and a string holding a lone surrogate such as `"\ud83d"`, which Swift can't read: a file one product accepts, the other must accept too.
- If the store on disk or in localStorage is corrupt: don't overwrite it. Keep a copy (`daybook.corrupt.json` / key `daybook.v1.corrupt`), start empty, and say so once.
- Every change saves immediately. iOS: atomic write to `Application Support/Daybook/daybook.json`. Web: localStorage key `daybook.v1`; if saving throws (private mode, quota), show a persistent, polite banner; never crash. Call `navigator.storage.persist?.()` once. Re-render when another tab changes the data (`storage` event).

## Design tokens

Colour (light / dark). Same values in both products. On iOS, prefer system semantic colours where they match closely, and asset-catalog colours for the rest.

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent-fill` | `#E0281D` | `#E0281D` | Today disc, checked circle, `+` button. White text and icons on it |
| `accent-text` | `#E0281D` | `#FF6259` | Tint for text buttons, today number, agenda bar |
| `label` | `#1D1D1F` | `#F5F5F7` | Primary text |
| `label-2` | `#6E6E73` | `#98989D` | Secondary text, fresh age line, adjacent-month days |
| `label-3` | `#8E8E93` | `#7C7C80` | Placeholder, empty circle stroke (under 4.5:1, so never for readable text) |
| `sep` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.10)` | Hairlines |
| `bg` | `#F5F5F7` | `#000000` | Web page behind cards |
| `card` | `#FFFFFF` | `#1C1C1E` | Web cards and sheets |
| `age-warm` | `#B25F00` | `#FFB340` | 7 to 29 days |
| `age-old` | `#D70015` | `#FF6961` | 30 days or more |

Red is the only hue besides the age colours. These were chosen to pass WCAG AA. Don't lighten them.

Type: the system font (web stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`). Month title 34 bold, section headers 17 semibold, body 17, secondary 13 to 15. Numerals tabular in the grid. On the web, tracking as on apple.com (-0.022em on 17 px text, -0.016em on 13 to 15 px text, -0.012em on the 34 px titles), antialiased smoothing, 16 px minimum on inputs (iOS zooms below that). Interface copy uses the typographic apostrophe (’), not the straight one, on both platforms.

Shape and motion: continuous-looking corners (web cards 20 px, sheets 16 to 20 px), hairlines rather than borders, shadows barely there and only in light mode. Animate only what changed: 200 to 300 ms, with an iOS-like curve (`cubic-bezier(.32,.72,0,1)` on the web, springs on iOS). Honour Reduce Motion everywhere.

Icon artwork is already generated: `Daybook/Assets.xcassets/AppIcon.appiconset` (light, dark, tinted) and `~/daybook-web/docs/icons` (`favicon.svg`, `icon-180/192/512.png`). The motif is a red disc with a white check, the same mark as "today" and "done". Regenerate with `Tools/icon/make-icons.sh`.

## iOS specifics

- Native components wherever they exist (`TabView`, `NavigationStack`, `List`, `Form`, sheets, `DatePicker`, `ContentUnavailableView`), so the app picks up Liquid Glass on iOS 26 and looks right on iOS 17. Custom-drawn only for the month grid and the check circle. Anything iOS 26-only (`glassEffect`) sits behind `#available` with a material fallback.
- iPhone: two tabs, `Calendar` and `To-Do` (SF Symbols `calendar`, `checklist`), with the open count as the To-Do tab badge. iPad / regular width: no tabs, the two screens side by side.
- `@Observable @MainActor` store, injected through the environment, with an injectable file URL for tests. Codable models. `CalendarDay` value type. Pure functions for the age and duration wording and the month grid.
- Month paging: a horizontal paging `ScrollView` + `LazyHStack` with `scrollTargetBehavior(.paging)` and `scrollPosition(id:)`, or whatever proves smoothest. Check that Today jumps cleanly from far away.
- Roll over at midnight (`.NSCalendarDayChanged`, and on returning to the foreground), and follow time zone changes (use `autoupdatingCurrent`).
- `TimelineView` or equivalent for live age lines. Sensory feedback: selection on day change, success on check-off.
- Accessibility: every grid day is a button labelled like `Thursday, November 5, 2 events`, with selected and today traits. Check circles labelled `Mark Essay as done`. Grid keeps working at the largest Dynamic Type sizes (cap the grid's numerals if needed, never the lists).
- Project: hand-written `Daybook.xcodeproj` with synced folders (`PBXFileSystemSynchronizedRootGroup`, objectVersion 77; xcodegen isn't installed). `GENERATE_INFOPLIST_FILE`, display name `Daybook`, version 1.0, build 1, `ITSAppUsesNonExemptEncryption = NO`, a `PrivacyInfo.xcprivacy` declaring UserDefaults use if `@AppStorage` is used. Swift 6 language mode if it causes no friction. Zero warnings in the app target.
- Targets: `Daybook`, `DaybookTests` (unit), `DaybookUITests` (XCUITest flows).
- Debug launch arguments (compiled only in DEBUG): `-reset YES` empties data; `-demo YES` seeds believable fictional data relative to now (no real names); `-tab calendar|todo`.
- `Tools/run.sh` (build, install and launch on the simulator with filtered output, passing launch args through) and `Tools/test.sh` (unit + UI tests, filtered). `README.md` with screenshots.

### Testing rules on this Mac

- **Never read a raw xcodebuild log.** Always pipe through `grep -E "error:|warning:|BUILD (SUCCEEDED|FAILED)|Test (Suite|Case).*(failed|passed)|Executed" | head -60` or similar. Use `-derivedDataPath ~/Developer/Daybook/.derived` (gitignored).
- Use only the dedicated simulators: `Daybook iPhone` `BCE01784-BF40-4AFF-8C6C-70793B6469DC`, `Daybook SE` `EBFF4441-D2EC-48BE-954D-3BFAEECCA495`, `Daybook iPad` `6AEF6166-AC8D-401C-A802-8FF300C51C3D`. All are iOS 26.5. Other simulators belong to other running sessions: don't boot, shut down or install on them. Pass `-parallel-testing-enabled NO`. Shut your simulators down when finished.
- Drive tests with XCUITest and `xcrun simctl` (`launch`, `io <id> screenshot`, `ui <id> appearance dark`, `ui <id> content_size extra-extra-extra-large`). **Don't use the `mcp__Claude_Code_iOS_Simulator` tool**: it prompts the user, who is away.
- The app makes no sound. Never touch the Mac's volume.
- Look at your screenshots with the Read tool. A passing test doesn't prove it's beautiful.

## Web specifics

- Files under `docs/`: `index.html`, `style.css`, `js/*.js` (ES modules), `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll`. Tests and tooling live outside `docs/`, so they're never published.
- All URLs relative. The site is served from `/daybook/`, not the domain root; test it there.
- Layout, 1000 px and up: slim top bar (the red check mark + `Daybook`, `…` menu right), then two cards side by side filling the viewport height, each scrolling internally: Calendar (about 58%) with grid above agenda, To-Do (about 42%). Below 1000 px: one screen at a time, full-bleed `card` background, a translucent blurred bottom tab bar (`Calendar`, `To-Do`, with inline SVG icons), safe-area padding (`viewport-fit=cover`), `100dvh`. No horizontal scrolling down to 320 px wide.
- Sheets: `<dialog>` with `showModal()` for correct focus trapping; centred 440 px card with a soft blurred backdrop on desktop; a bottom sheet on phones; slide-up animation; Esc and backdrop click cancel. Fields styled as iOS inset groups, with a real `<input type=checkbox role=switch>` styled as a switch and native `date`/`time` inputs.
- Touch: swipe months with pointer events, swipe-to-delete on rows (with `touch-action: pan-y`), plus visible delete affordance in the editor since mouse users can't swipe.
- Keyboard: grid uses a roving tabindex. Arrows move the selection, PageUp/PageDown change month, Home/End go to week start/end, `T` is today, `N` is new event (only when focus isn't in a field). Visible focus rings (`:focus-visible`). Double-click a day for a new event.
- Accessibility: grid semantics, `aria-current="date"`, `aria-selected`, labels like `Thursday, November 5, 2 events`, live region for toasts, `role=switch`. axe-core must report zero serious or critical violations in light and dark, on desktop and phone layouts.
- Never put user text through `innerHTML`. Use `textContent`/DOM APIs.
- Use `crypto.randomUUID` with a `getRandomValues` fallback. UI language is English: month and weekday names come from `Intl.DateTimeFormat('en', …)`, while first weekday and 12/24-hour choice come from the browser's locale (with Sunday as the fallback).
- Live data: refresh age lines on an interval and on `visibilitychange`; roll "today" over at midnight.
- PWA: manifest (name, icons, `display: standalone`, theme colours), `apple-touch-icon`, `theme-color` for light and dark, `apple-mobile-web-app-*` metas, and a small network-first service worker with cache fallback so it opens offline without ever pinning a stale version. Title `Daybook`, a good meta description, Open Graph tags with a real preview image rendered from the site with fictional data (`docs/og.png`, 1200×630).
- The first visit starts empty, but must not look broken. No demo data for real users. A `?demo` URL parameter that seeds fictional data in memory only (never saved) exists for screenshots and tests.
- Tests live in `test/`: `node --test` for pure logic (age and duration tables, grid generation, event-on-day rules, validation, fixture), and E2E with `playwright-core` driving the installed Chrome (`channel: 'chrome'`, headless). E2E covers: add, edit, delete + undo an event; add, check off, reopen, delete + undo a task; persistence across reload; export then import round trip; bad-file rejection; corrupt localStorage; `/daybook/` base path; no console errors; no off-origin requests; axe in all four mode/layout combinations; a timezone west and east of UTC (`timezoneId`) to catch off-by-one days. Save screenshots to `test/artifacts/` (gitignored) and look at them with the Read tool. `README.md` links the live site.
- Serve locally however the tests need; don't use the shared Browser pane. For an ad-hoc look, a Playwright screenshot is enough.

## Not in this version

Sync, accounts, repeating events, notifications, multiple calendars, event colours, task due dates, priorities, tags, translations. Don't add them, and don't leave room for them in the UI.
