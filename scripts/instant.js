import { init, i } from "https://esm.sh/@instantdb/core";

const STATION_IDS = ["A", "B", "C", "D", "E"];
const GAME_ASSIGNMENTS_SLUG = "default";
const INITIAL_ASSIGNMENT_SLUG = "default";

const INSTANT_SCHEMA = i.schema({
  entities: {
    game_assignments: i.entity({
      slug: i.string().unique().indexed(),
      names: i.json().optional(),
      teams: i.json().optional(),
      updatedAt: i.number().optional(),
    }),
    initial_station_assignment: i.entity({
      slug: i.string().unique().indexed().optional(),
      stationOrder: i.json().optional(),
      updatedAt: i.number().optional(),
    }),
    station_occupancy: i.entity({
      stationId: i.string().unique().indexed(),
      state: i.string().optional(),
      occupiedByTeamId: i.string().optional(),
      occupiedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    team_statuses: i.entity({
      teamId: i.string().unique().indexed(),
      stepIndex: i.number().optional(),
      completed: i.boolean().optional(),
      updatedAt: i.number().optional(),
    }),
    team_current_assignment: i.entity({
      teamId: i.string().unique().indexed(),
      currentStationId: i.string().optional(),
      assignedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    team_station_progress: i.entity({
      progressKey: i.string().unique().indexed().optional(),
      teamId: i.string().optional(),
      stationId: i.string().optional(),
      status: i.string().optional(),
      completedAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
  },
});

let db = null;
let subscribed = false;
let stationSubscribed = false;
let assignmentsSubscribed = false;
let teamSeeded = false;
let stationSeeded = false;
/** Cached from last station subscription so Start Game can use existing order before creating one. */
let cachedInitialStationOrder = null;

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
    db.tx.team_statuses.lookup("teamId", team.id).update({ ...buildPayload(team), teamId: team.id })
  );
  db.transact(txs);
}

function seedStationOccupancy() {
  if (!db) return;
  const txs = STATION_IDS.map((id) =>
    db.tx.station_occupancy.lookup("stationId", id).update({
      stationId: id,
      state: "open",
      occupiedByTeamId: null,
      occupiedAt: null,
      updatedAt: Date.now(),
    })
  );
  db.transact(txs);
}

function toRows(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return Object.entries(val).map(([k, v]) => ({ ...v, id: v?.id ?? v?.stationId ?? k }));
  return [];
}

function parseStationData(data) {
  const stationOccupancy = {};
  const teamAssignments = {};
  const teamProgress = {};

  STATION_IDS.forEach((id) => {
    stationOccupancy[id] = { state: "open", occupiedByTeamId: null };
  });
  toRows(data.station_occupancy).forEach((row) => {
    const id = row.id ?? row.stationId;
    if (id) {
      stationOccupancy[id] = {
        state: row.state === "occupied" ? "occupied" : "open",
        occupiedByTeamId: row.occupiedByTeamId || null,
      };
    }
  });

  toRows(data.team_current_assignment).forEach((row) => {
    if (row && row.teamId) {
      teamAssignments[row.teamId] = row.currentStationId || null;
    }
  });

  toRows(data.team_station_progress).forEach((row) => {
    if (row && row.teamId && row.stationId && row.status === "completed") {
      if (!teamProgress[row.teamId]) teamProgress[row.teamId] = [];
      if (!teamProgress[row.teamId].includes(row.stationId)) {
        teamProgress[row.teamId].push(row.stationId);
      }
    }
  });

  const raw = data.initial_station_assignment;
  const initialRows = toRows(raw ?? []);
  const initialRow = initialRows.find((r) => r && r.slug === INITIAL_ASSIGNMENT_SLUG) || initialRows[0];
  const initialStationOrder =
    Array.isArray(initialRow?.stationOrder) && initialRow.stationOrder.length === 4
      ? initialRow.stationOrder
      : null;
  cachedInitialStationOrder = initialStationOrder;

  return { stationOccupancy, teamAssignments, teamProgress, initialStationOrder };
}

function parseAssignmentsData(data) {
  const raw = data.game_assignments;
  const rows = toRows(raw ?? []);
  const row = rows.find((r) => r && r.slug === GAME_ASSIGNMENTS_SLUG) || rows[0];
  if (!row) return { names: [], teams: {} };
  return {
    names: Array.isArray(row.names) ? row.names : [],
    teams: row.teams && typeof row.teams === "object" ? row.teams : {},
  };
}

export function initInstant(appId, teams, onRemoteUpdate, onStatus, onRemoteStationData, onRemoteAssignments) {
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
  db = init({
    appId,
    schema: INSTANT_SCHEMA,
    verbose: true,
  });
  if (db && typeof db.on === "function") {
    db.on("error", (err) => {
      console.warn("[InstantDB] error:", err?.message ?? err);
      if (err?.hint) console.warn("[InstantDB] hint:", err.hint);
    });
  }

  if (!assignmentsSubscribed && typeof onRemoteAssignments === "function") {
    db.subscribeQuery({ game_assignments: {} }, (resp) => {
      if (resp.error) {
        console.warn("[Assignments] subscription error:", resp.error);
        return;
      }
      if (!resp.data) return;
      const parsed = parseAssignmentsData(resp.data);
      const teamCounts = parsed.teams && typeof parsed.teams === "object"
        ? Object.entries(parsed.teams).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
        : [];
      console.log("[Assignments] subscription payload:", {
        namesLength: Array.isArray(parsed.names) ? parsed.names.length : 0,
        teamCounts: Object.fromEntries(teamCounts),
      });
      onRemoteAssignments(parsed);
    });
    assignmentsSubscribed = true;
  }

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

/** Returns the last initial station order from the station subscription (so we don't create a new game if one exists). */
export function getCachedInitialStationOrder() {
  return cachedInitialStationOrder != null && Array.isArray(cachedInitialStationOrder) && cachedInitialStationOrder.length === 4
    ? [...cachedInitialStationOrder]
    : null;
}

/** One-time fetch of initial_station_assignment so we only create a new game when none exists. */
export async function fetchInitialStationAssignmentOnce() {
  if (!db) return null;
  try {
    if (typeof db.queryOnce === "function") {
      const data = await db.queryOnce({ initial_station_assignment: {} });
      const raw = data?.initial_station_assignment;
      const rows = toRows(raw ?? []);
      const row = rows.find((r) => r && r.slug === INITIAL_ASSIGNMENT_SLUG) || rows.find((r) => r?.stationOrder) || rows[0];
      if (Array.isArray(row?.stationOrder) && row.stationOrder.length === 4) return row.stationOrder;
    }
  } catch (e) {
    console.warn("fetchInitialStationAssignmentOnce:", e);
  }
  return getCachedInitialStationOrder();
}

export function fetchAssignmentsOnce() {
  if (!db || typeof db.queryOnce !== "function") {
    console.log("[Assignments] fetchAssignmentsOnce skipped (no db or queryOnce)");
    return Promise.resolve(null);
  }
  return db
    .queryOnce({ game_assignments: {} })
    .then((data) => {
      if (!data) {
        console.log("[Assignments] fetchAssignmentsOnce raw: null/empty");
        return null;
      }
      const parsed = data ? parseAssignmentsData(data) : null;
      if (parsed) {
        const teamCounts = parsed.teams && typeof parsed.teams === "object"
          ? Object.fromEntries(Object.entries(parsed.teams).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]))
          : {};
        console.log("[Assignments] fetchAssignmentsOnce parsed:", {
          namesLength: Array.isArray(parsed.names) ? parsed.names.length : 0,
          teamCounts,
        });
      } else {
        console.log("[Assignments] fetchAssignmentsOnce parse returned null");
      }
      return parsed;
    })
    .catch((e) => {
      console.warn("[Assignments] fetchAssignmentsOnce error:", e);
      return null;
    });
}

export function persistAssignments(names, teams) {
  if (!db || !teams || typeof teams !== "object") return;
  db.transact(
    db.tx.game_assignments.lookup("slug", GAME_ASSIGNMENTS_SLUG).update({
      slug: GAME_ASSIGNMENTS_SLUG,
      names: Array.isArray(names) ? names : [],
      teams,
      updatedAt: Date.now(),
    })
  );
}

/** Clear game_assignments in DB so all devices see a full reset (no names, no team members). */
export function clearGameAssignments(teamIds) {
  if (!db) return;
  const teams = Array.isArray(teamIds)
    ? teamIds.reduce((acc, id) => ({ ...acc, [id]: [] }), {})
    : {};
  db.transact(
    db.tx.game_assignments.lookup("slug", GAME_ASSIGNMENTS_SLUG).update({
      slug: GAME_ASSIGNMENTS_SLUG,
      names: [],
      teams,
      updatedAt: Date.now(),
    })
  );
}

export function persistTeamStatus(team) {
  if (!db || !team) return;
  db.transact(db.tx.team_statuses.lookup("teamId", team.id).update({ ...buildPayload(team), teamId: team.id }));
}

export function persistAllTeamStatuses(teams) {
  if (!db || !teams?.length) return;
  const txs = teams.map((team) =>
    db.tx.team_statuses.lookup("teamId", team.id).update({ ...buildPayload(team), teamId: team.id })
  );
  db.transact(txs);
}

export function releaseStation(stationId) {
  if (!db || !stationId) return;
  db.transact(
    db.tx.station_occupancy.lookup("stationId", stationId).update({
      stationId,
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
    db.tx.station_occupancy.lookup("stationId", stationId).update({
      stationId,
      state: "occupied",
      occupiedByTeamId: teamId,
      occupiedAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}

export function completeStationForTeam(teamId, stationId) {
  if (!db || !teamId || !stationId) return;
  const progressKey = `${teamId}-${stationId}`;
  db.transact(
    db.tx.team_station_progress.lookup("progressKey", progressKey).update({
      progressKey,
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
    db.tx.team_current_assignment.lookup("teamId", teamId).update({
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
    db.tx.team_current_assignment.lookup("teamId", teamId).update({
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
      db.tx.team_station_progress.lookup("progressKey", `${teamId}-${stationId}`).delete()
    );
    db.transact(txs);
  } catch (e) {
    console.warn("clearTeamProgress:", e);
  }
}

export function clearAllStationData() {
  if (!db) return;
  const txs = STATION_IDS.map((id) =>
    db.tx.station_occupancy.lookup("stationId", id).update({
      stationId: id,
      state: "open",
      occupiedByTeamId: null,
      occupiedAt: null,
      updatedAt: Date.now(),
    })
  );
  db.transact(txs);
}

/** Write initial station order and assign each team to a distinct station. Call when starting a new game. */
export function writeInitialStationAssignment(teamIds, stationOrder) {
  if (!db || !Array.isArray(teamIds) || !Array.isArray(stationOrder) || stationOrder.length !== 4) return;
  const txs = [
    db.tx.initial_station_assignment.lookup("slug", INITIAL_ASSIGNMENT_SLUG).update({
      slug: INITIAL_ASSIGNMENT_SLUG,
      stationOrder,
      updatedAt: Date.now(),
    }),
  ];
  for (let i = 0; i < 4; i++) {
    const stationId = stationOrder[i];
    const teamId = teamIds[i];
    if (!stationId || !teamId) continue;
    txs.push(
      db.tx.station_occupancy.lookup("stationId", stationId).update({
        stationId,
        state: "occupied",
        occupiedByTeamId: teamId,
        occupiedAt: Date.now(),
        updatedAt: Date.now(),
      }),
      db.tx.team_current_assignment.lookup("teamId", teamId).update({
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
    db.transact(db.tx.initial_station_assignment.lookup("slug", INITIAL_ASSIGNMENT_SLUG).delete());
  } catch (e) {
    console.warn("clearInitialStationAssignment:", e);
  }
}
