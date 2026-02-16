# Pokemon Park Quest v2 — Dynamic Station Routing Plan

## Summary

Significant architecture change from v1: fixed per-team steps (1→2→3→4→5) are replaced by dynamic routing where teams are assigned to the next available station based on real-time occupancy in InstantDB.

---

## Architecture Comparison

```
v1: Team → Steps[1..5] (fixed order) → Team Completed
v2: Team → currentStation (from pool) → on code success → release station → assign next available
     Stations A–E shared; occupancy in InstantDB
```

---

## 1. New Data: Stations Config

**Create:** `data/stations.json`

Define 5 stations (A–E) from the spec. Each station has:

| Field | Type | Example |
|-------|------|---------|
| id | string | "A", "B", "C", "D", "E" |
| name | string | "Power Throw Challenge" |
| zone | string | "Playground" |
| themeType | string | "Fire / Strength" |
| clue | string | Short riddle directing kids to the target |
| code | string | "CHAR-HIT" |
| setup | string | Setup instructions |
| howToPlay | string[] | Numbered steps |
| winCondition | string | "3 hits on target" |
| reset | string | Reset notes |
| parentTip | string | Optional |
| musicLink | string | Only Station D — Apple Music URL |

Station mapping:
- **A** — Playground: Power Throw Challenge (Fire)
- **B** — Water: Water Transfer Relay
- **C** — Trees: Leaf Path Balance (Grass)
- **D** — Open Field: Electric Freeze Dash / Pikachu Dance Party (Electric) — includes `musicLink`
- **E** — Benches: Memory Match Battle (Mixed)

---

## 2. Simplify Teams Config

**Modify:** `data/teams.json`

Remove `steps` array. Keep `id`, `name`, `color` for Red, Blue, Green, Yellow.

---

## 3. InstantDB Schema Extension

**Current:** `team_statuses` (teamId, stepIndex, completed)

**Add:** New entities for v2. Project has no `instant.schema.ts`; InstantDB can auto-create entities from transact, or add schema file for type safety.

| Entity | Key Pattern | Attributes |
|--------|-------------|------------|
| station_occupancy | stationId (A–E) | stationId, state (open/occupied), occupiedByTeamId, occupiedAt |
| team_station_progress | teamId-stationId | teamId, stationId, status (completed), completedAt |
| team_current_assignment | teamId | teamId, currentStationId, assignedAt |

Seed `station_occupancy` for A–E as `open` on first run.

---

## 4. State Model Changes

| v1 State | v2 State |
|----------|----------|
| team.stepIndex | team.completedStationIds[] (or derive from progress) |
| team.completed | completedStationIds.length === 5 |
| — | team.currentStationId |
| — | stationOccupancy map (from InstantDB) |
| maxSteps | 5 (or stations.length) |

---

## 5. InstantDB Module Refactor

**Modify:** `scripts/instant.js`

- Subscribe to: station_occupancy, team_station_progress, team_current_assignment
- Seed station_occupancy (A–E open) on first run
- Add: releaseStation, occupyStation, completeStationForTeam, assignTeamToStation
- Use transactions for atomic occupancy updates

---

## 6. Dynamic Routing Logic

```
assignNextStation(teamId):
  1. completedStations = stations team has completed
  2. remainingStations = all - completedStations
  3. availableStations = remaining where occupancy.state == open
  4. If non-empty: pick one, occupy, assign, return station
  5. Else: return null → show "Waiting" + Trivia
```

On code success:
1. Validate code against current station
2. completeStationForTeam, releaseStation
3. If team has 5 completions → Team Completed screen
4. Else → assignNextStation:
   - If result: "Next station: X" + "Go to Next Station"
   - If null: "Waiting for next station" + "Play Trivia"

---

## 7. UI Changes — Per-Station Screen

**Modify:** renderTeamScreen → renderStationScreen

Sections (per spec 4.1):
1. Team Header — name, "X of 5 stations completed"
2. Current Station — "Station D: Electric Freeze Dash — Open Field"
3. Clue / Riddle
4. **Activity Details (NEW)** — Setup, How to Play, Win Condition, Reset, Parent Tip
5. Code Entry
6. Code Clue (existing, uses station code)
7. **Station D only:** "Play Pokémon Theme Song" button
8. **After success:** "Great job! Next station: …" + "Go to Next Station"

---

## 8. Apple Music Button (Station D)

- Add musicLink to Station D in stations.json (placeholder OK)
- Render button when station.id === "D" and musicLink exists
- Handler: window.location.href = station.musicLink

---

## 9. "Waiting for Next Station" State

When assignNextStation returns null:
- Show "Waiting for next station to open…"
- Show "Play Trivia" button
- Optionally poll or re-run on InstantDB subscription update

---

## 10. File Change Summary

| File | Action |
|------|--------|
| data/stations.json | Create — 5 stations with activity details |
| data/teams.json | Modify — Remove steps, keep id/name/color |
| scripts/instant.js | Modify — New entities, subscriptions, routing helpers |
| scripts/app.js | Modify — State, routing logic, renderStationScreen, Activity Details, Apple Music |
| scripts/storage.js | Modify — v2 state shape |
| styles/components.css | Modify — Activity Details styles if needed |
| instant.schema.ts | Optional — Schema-first setup |

---

## Implementation Order

1. Create data/stations.json
2. Simplify data/teams.json
3. Add v2 state model + LocalStorage (local-only flow first)
4. Extend scripts/instant.js
5. Refactor scripts/app.js (routing, renderStationScreen, Activity Details, Apple Music)
6. Wire subscriptions and "Waiting" state
7. Test offline and with InstantDB
8. Add instant.schema.ts and push schema if desired
