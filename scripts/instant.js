import { init } from "https://esm.sh/@instantdb/core";

let db = null;
let subscribed = false;
let seeded = false;

function buildPayload(team) {
  return {
    teamId: team.id,
    stepIndex: team.stepIndex,
    completed: team.completed,
    updatedAt: Date.now(),
  };
}

function seedTeamStatuses(teams) {
  if (!db || !teams?.length) {
    return;
  }
  const txs = teams.map((team) =>
    db.tx.team_statuses[team.id].update(buildPayload(team))
  );
  db.transact(txs);
}

export function initInstant(appId, teams, onRemoteUpdate, onStatus) {
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
      if (!resp.data) {
        return;
      }
      if (typeof onStatus === "function") {
        onStatus({ state: "connected", text: "InstantDB: connected" });
      }
      const teamStatuses = resp.data.team_statuses || [];
      if (!teamStatuses.length && !seeded) {
        seedTeamStatuses(teams);
        seeded = true;
        return;
      }
      if (typeof onRemoteUpdate === "function") {
        onRemoteUpdate(teamStatuses);
      }
    });
    subscribed = true;
  }
  return db;
}

export function persistTeamStatus(team) {
  if (!db || !team) {
    return;
  }
  db.transact(db.tx.team_statuses[team.id].update(buildPayload(team)));
}

export function persistAllTeamStatuses(teams) {
  if (!db || !teams?.length) {
    return;
  }
  const txs = teams.map((team) =>
    db.tx.team_statuses[team.id].update(buildPayload(team))
  );
  db.transact(txs);
}
