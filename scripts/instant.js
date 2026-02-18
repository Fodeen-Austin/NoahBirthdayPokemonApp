import { init } from "https://esm.sh/@instantdb/core";

const STATION_IDS = ["A", "B", "C", "D", "E"];

let db = null;
let subscribed = false;
let stationSubscribed = false;
let teamSeeded = false;
let stationSeeded = false;

function buildPayload(team) {
  return {
    teamId: team.id,
    stepIndex: team.stepIndex,
    completed: team.completed,
    updatedAt: Date.now(),
  };
}

function seedTeamStatuses(teams) {
  if (!db || !teams?.length) return;
  const txs = teams.map((team) =>
    db.tx.team_statuses[team.id].update(buildPayload(team))
  );
  db.transact(txs);
}

function seedStationOccupancy() {
  if (!db) return;
  const txs = STATION_IDS.map((id) =>
    db.tx.station_occupancy[id].update({
      stationId: id,
      state: "open",
      occupiedByTeamId: null,
      occupiedAt: null,
      updatedAt: Date.now(),
    })
  );
  db.transact(txs);
}

function parseStationData(data) {
  const stationOccupancy = {};
  const teamAssignments = {};
  const teamProgress = {};

  STATION_IDS.forEach((id) => {
    stationOccupancy[id] = { state: "open", occupiedByTeamId: null };
  });
  (data.station_occupancy || []).forEach((row) => {
    if (row && row.id) {
      stationOccupancy[row.id] = {
        state: row.state === "occupied" ? "occupied" : "open",
        occupiedByTeamId: row.occupiedByTeamId || null,
      };
    }
  });

  (data.team_current_assignment || []).forEach((row) => {
    if (row && row.teamId) {
      teamAssignments[row.teamId] = row.currentStationId || null;
    }
  });

  (data.team_station_progress || []).forEach((row) => {
    if (row && row.teamId && row.stationId && row.status === "completed") {
      if (!teamProgress[row.teamId]) teamProgress[row.teamId] = [];
      if (!teamProgress[row.teamId].includes(row.stationId)) {
        teamProgress[row.teamId].push(row.stationId);
      }
    }
  });

  const initialRows = data.initial_station_assignment || [];
  const initialStationOrder =
    Array.isArray(initialRows[0]?.stationOrder) && initialRows[0].stationOrder.length === 4
      ? initialRows[0].stationOrder
      : null;

  return { stationOccupancy, teamAssignments, teamProgress, initialStationOrder };
}

export function initInstant(appId, teams, onRemoteUpdate, onStatus, onRemoteStationData) {
  if (!appId) {
    if (typeof onStatus === "function") {
      onStatus({ state: "offline", text: "InstantDB: local only" });
    }
    console.info("InstantDB app ID missing. Running in local-only mode.");
    return null;
  }
  if (typeof onStatus === "function") {
    onStatus({ state: "connecting", text: "InstantDB: connecting..." });
  }
  db = init({ appId });

  if (!subscribed) {
    db.subscribeQuery({ team_statuses: {} }, (resp) => {
      if (resp.error) {
        console.warn("InstantDB subscription error.", resp.error);
        if (typeof onStatus === "function") {
          onStatus({ state: "error", text: "InstantDB: error" });
        }
        return;
      }
      if (!resp.data) return;
      if (typeof onStatus === "function") {
        onStatus({ state: "connected", text: "InstantDB: connected" });
      }
      const teamStatuses = resp.data.team_statuses || [];
      if (!teamStatuses.length && !teamSeeded) {
        seedTeamStatuses(teams);
        teamSeeded = true;
        return;
      }
      if (typeof onRemoteUpdate === "function") {
        onRemoteUpdate(teamStatuses);
      }
    });
    subscribed = true;
  }

  if (!stationSubscribed) {
    db.subscribeQuery(
      {
        station_occupancy: {},
        team_current_assignment: {},
        team_station_progress: {},
        initial_station_assignment: {},
      },
      (resp) => {
        if (resp.error) {
          console.warn("InstantDB station subscription error.", resp.error);
          return;
        }
        if (!resp.data) return;
        const occ = resp.data.station_occupancy || [];
        if (occ.length === 0 && !stationSeeded) {
          seedStationOccupancy();
          stationSeeded = true;
          return;
        }
        if (typeof onRemoteStationData === "function") {
          onRemoteStationData(parseStationData(resp.data));
        }
      }
    );
    stationSubscribed = true;
  }

  return db;
}

export function persistTeamStatus(team) {
  if (!db || !team) return;
  db.transact(db.tx.team_statuses[team.id].update(buildPayload(team)));
}

export function persistAllTeamStatuses(teams) {
  if (!db || !teams?.length) return;
  const txs = teams.map((team) =>
    db.tx.team_statuses[team.id].update(buildPayload(team))
  );
  db.transact(txs);
}

export function releaseStation(stationId) {
  if (!db || !stationId) return;
  db.transact(
    db.tx.station_occupancy[stationId].update({
      state: "open",
      occupiedByTeamId: null,
      occupiedAt: null,
      updatedAt: Date.now(),
    })
  );
}

export function occupyStation(stationId, teamId) {
  if (!db || !stationId || !teamId) return;
  db.transact(
    db.tx.station_occupancy[stationId].update({
      state: "occupied",
      occupiedByTeamId: teamId,
      occupiedAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}

export function completeStationForTeam(teamId, stationId) {
  if (!db || !teamId || !stationId) return;
  const progressId = `${teamId}-${stationId}`;
  db.transact(
    db.tx.team_station_progress[progressId].update({
      teamId,
      stationId,
      status: "completed",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}

export function assignTeamToStation(teamId, stationId) {
  if (!db || !teamId) return;
  db.transact(
    db.tx.team_current_assignment[teamId].update({
      teamId,
      currentStationId: stationId,
      assignedAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}

export function clearTeamAssignment(teamId) {
  if (!db || !teamId) return;
  db.transact(
    db.tx.team_current_assignment[teamId].update({
      teamId,
      currentStationId: null,
      assignedAt: null,
      updatedAt: Date.now(),
    })
  );
}

export function clearTeamProgress(teamId) {
  if (!db || !teamId) return;
  try {
    const txs = STATION_IDS.map((stationId) =>
      db.tx.team_station_progress[`${teamId}-${stationId}`].delete()
    );
    db.transact(txs);
  } catch (e) {
    console.warn("clearTeamProgress:", e);
  }
}

export function clearAllStationData() {
  if (!db) return;
  const txs = [];
  STATION_IDS.forEach((id) => {
    txs.push(
      db.tx.station_occupancy[id].update({
        state: "open",
        occupiedByTeamId: null,
        occupiedAt: null,
        updatedAt: Date.now(),
      })
    );
  });
  db.transact(txs);
}

const INITIAL_ASSIGNMENT_ID = "1";

/** Write initial station order and assign each team to a distinct station. Call when starting a new game. */
export function writeInitialStationAssignment(teamIds, stationOrder) {
  if (!db || !Array.isArray(teamIds) || !Array.isArray(stationOrder) || stationOrder.length !== 4) return;
  const txs = [
    db.tx.initial_station_assignment[INITIAL_ASSIGNMENT_ID].update({
      stationOrder,
      updatedAt: Date.now(),
    }),
  ];
  for (let i = 0; i < 4; i++) {
    const stationId = stationOrder[i];
    const teamId = teamIds[i];
    if (!stationId || !teamId) continue;
    txs.push(
      db.tx.station_occupancy[stationId].update({
        stationId,
        state: "occupied",
        occupiedByTeamId: teamId,
        occupiedAt: Date.now(),
        updatedAt: Date.now(),
      }),
      db.tx.team_current_assignment[teamId].update({
        teamId,
        currentStationId: stationId,
        assignedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
  }
  db.transact(txs);
}

/** Clear initial assignment entity so next Start Game creates a new random assignment. */
export function clearInitialStationAssignment() {
  if (!db) return;
  try {
    db.transact(db.tx.initial_station_assignment[INITIAL_ASSIGNMENT_ID].delete());
  } catch (e) {
    console.warn("clearInitialStationAssignment:", e);
  }
}
