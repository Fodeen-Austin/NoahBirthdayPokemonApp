# Pokemon Park Quest v2 - Testing Guide

## Offline / Local-Only Mode

1. Open the app without an InstantDB app ID (or remove `instantAppId` from `data/config.json`).
2. Status should show "InstantDB: local only".
3. Start Game → Pick a team → Team should be assigned to a station immediately.
4. Complete the station by entering the correct code (e.g. CHAR-HIT for Station A).
5. Verify "Great job! Next station: X" appears, then "Go to Next Station".
6. Complete all 5 stations → Team Completed → Play Trivia.
7. Reset Game → Verify all progress clears.

## With InstantDB

1. Ensure `instantAppId` is set in `data/config.json`.
2. Status should show "InstantDB: connected" when online.
3. Open the app in two browser tabs/windows (or two devices).
4. Tab 1: Pick Red team, get assigned Station A.
5. Tab 2: Pick Blue team, get assigned a different station (B, C, D, or E).
6. Tab 1: Complete Station A, get next station.
7. Tab 2: Should see updated occupancy; completing a station frees it for others.
8. Verify no two teams can occupy the same station at once.
9. When one team is "Waiting for next station" and another completes, the waiting team can click "Check for Available Station" to get assigned.
10. When all 4 teams complete 5 stations, Final Clue unlocks.

## InstantDB Entities (auto-created on first use)

- `team_statuses` — teamId, stepIndex, completed (legacy progress sync)
- `station_occupancy` — stationId (A–E), state, occupiedByTeamId
- `team_current_assignment` — teamId, currentStationId
- `team_station_progress` — teamId-stationId, teamId, stationId, status

## Common Issues

- **"Waiting for next station" forever**: All stations may be occupied. Have another team complete their station.
- **Reset doesn't clear remote**: Reset clears local state and pushes to InstantDB. Other devices will receive the update via subscription.
- **Duplicate assignment**: Rare race condition if two devices assign at the same moment. Refresh and retry.
