import { loadState, saveState, clearState } from "./storage.js";
import { getRandomQuestion, pickQuestionById } from "./trivia.js";
import {
  initInstant,
  persistAllTeamStatuses,
  persistTeamStatus,
  releaseStation,
  occupyStation,
  completeStationForTeam,
  assignTeamToStation,
  clearTeamAssignment,
  clearTeamProgress,
  clearAllStationData,
  writeInitialStationAssignment,
  clearInitialStationAssignment,
} from "./instant.js";

const appEl = document.getElementById("app");

const appData = {
  config: null,
  teams: [],
  stations: [],
  trivia: [],
  pokemonPool: [],
};

const STATION_IDS = ["A", "B", "C", "D", "E"];

let state = null;
let currentScreen = "home";
let feedback = null;
let triviaFeedback = null;
let codeClueState = { revealed: false, stepKey: null };
let codeSuccessNextStation = null; // { station } when showing "Next station: X"
let codeClueFeedback = null;
let resetTeamId = null;
let instantStatus = { state: "idle", text: "InstantDB: connecting..." };

const DEFAULT_NAME_INPUTS = 12;

init();

async function init() {
  await loadData();
  state = normalizeState(
    loadState() || buildInitialState(appData.teams, appData.stations, appData.config),
    appData.teams,
    appData.config,
    appData.stations
  );
  if (!resetTeamId && appData.teams.length) {
    resetTeamId = appData.teams[0].id;
  }
  initInstant(
    appData.config.instantAppId,
    getTeamsForInstantSync(),
    applyRemoteTeamStatuses,
    handleInstantStatus,
    applyRemoteStationData
  );
  if (state.finalUnlocked) {
    currentScreen = "final";
  }
  updateFinalUnlocked();
  render();
}

async function loadData() {
  const [config, teams, stations, trivia, pokemonPool] = await Promise.all([
    fetch("./data/config.json").then((res) => res.json()),
    fetch("./data/teams.json").then((res) => res.json()),
    fetch("./data/stations.json").then((res) => res.json()),
    fetch("./data/trivia.json").then((res) => res.json()),
    fetch("./data/pokemon-pool.json").then((res) => res.json()),
  ]);
  appData.config = config;
  appData.teams = teams;
  appData.stations = stations;
  appData.trivia = trivia;
  appData.pokemonPool = Array.isArray(pokemonPool) ? pokemonPool : [];
  document.title = config.appTitle;
}

function buildInitialState(teams, stations, config) {
  const stationOccupancy = {};
  STATION_IDS.forEach((id) => {
    stationOccupancy[id] = { state: "open", occupiedByTeamId: null };
  });
  return {
    schemaVersion: 2,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      completedStationIds: [],
      currentStationId: null,
      completed: false,
      stationPokemonChoices: {},
    })),
    stationOccupancy,
    initialStationOrder: null,
    activeTeamId: null,
    finalUnlocked: false,
    trivia: {
      active: false,
      currentQuestionId: null,
      usedQuestionIds: [],
    },
    maxStations: stations?.length ?? 5,
    assignments: buildEmptyAssignments(teams),
  };
}

function buildEmptyAssignments(teams) {
  return {
    names: [],
    teams: teams.reduce((acc, team) => {
      acc[team.id] = [];
      return acc;
    }, {}),
  };
}

function normalizeState(loadedState, teams, config, stations) {
  const schemaVersion = loadedState?.schemaVersion ?? 1;
  if (schemaVersion < 2) {
    return buildInitialState(teams, stations, config);
  }
  const normalized = { ...loadedState };
  normalized.schemaVersion = 2;
  normalized.maxStations = stations?.length ?? 5;
  const stationOccupancy = normalized.stationOccupancy || {};
  STATION_IDS.forEach((id) => {
    if (!stationOccupancy[id]) {
      stationOccupancy[id] = { state: "open", occupiedByTeamId: null };
    }
  });
  normalized.stationOccupancy = stationOccupancy;
  normalized.teams = teams.map((team, index) => {
    const existing = loadedState.teams?.find((t) => t.id === team.id) ?? loadedState.teams?.[index];
    const completedStationIds = Array.isArray(existing?.completedStationIds)
      ? existing.completedStationIds
      : [];
    const completed = completedStationIds.length >= (normalized.maxStations ?? 5);
    const stationPokemonChoices =
      existing?.stationPokemonChoices && typeof existing.stationPokemonChoices === "object"
        ? existing.stationPokemonChoices
        : {};
    return {
      id: team.id,
      name: team.name,
      completedStationIds,
      currentStationId: existing?.currentStationId ?? null,
      completed,
      stationPokemonChoices,
    };
  });
  if (normalized.initialStationOrder == null) {
    normalized.initialStationOrder = null;
  }
  if (!normalized.trivia) {
    normalized.trivia = {
      active: false,
      currentQuestionId: null,
      usedQuestionIds: [],
    };
  }
  if (!normalized.assignments) {
    normalized.assignments = buildEmptyAssignments(teams);
  }
  if (!normalized.assignments.teams) {
    normalized.assignments.teams = buildEmptyAssignments(teams).teams;
  }
  if (!Array.isArray(normalized.assignments.names)) {
    normalized.assignments.names = [];
  }
  teams.forEach((team) => {
    if (!Array.isArray(normalized.assignments.teams[team.id])) {
      normalized.assignments.teams[team.id] = [];
    }
  });
  return normalized;
}

function handleInstantStatus(nextStatus) {
  if (!nextStatus) {
    return;
  }
  const { state: nextState, text: nextText } = nextStatus;
  if (instantStatus.state === nextState && instantStatus.text === nextText) {
    return;
  }
  instantStatus = { state: nextState, text: nextText };
  render();
}

function statusIndicatorMarkup() {
  const hasAppId = Boolean(appData.config?.instantAppId);
  if (!hasAppId) {
    return `<div class="status-pill muted">InstantDB: local only</div>`;
  }
  const statusClass =
    instantStatus.state === "connected"
      ? "status-ok"
      : instantStatus.state === "error"
        ? "status-warn"
        : "muted";
  return `<div class="status-pill ${statusClass}">${escapeHtml(
    instantStatus.text
  )}</div>`;
}

function applyRemoteStationData(parsed) {
  if (!parsed || !state) return;
  const { stationOccupancy, teamAssignments, teamProgress, initialStationOrder } = parsed;
  let changed = false;

  if (initialStationOrder != null && Array.isArray(initialStationOrder) && initialStationOrder.length === 4) {
    if (
      !state.initialStationOrder ||
      state.initialStationOrder.length !== 4 ||
      state.initialStationOrder.some((id, i) => id !== initialStationOrder[i])
    ) {
      state.initialStationOrder = [...initialStationOrder];
      changed = true;
    }
  }

  if (stationOccupancy) {
    STATION_IDS.forEach((id) => {
      const remote = stationOccupancy[id];
      if (remote && state.stationOccupancy[id]) {
        const local = state.stationOccupancy[id];
        if (
          remote.state !== local.state ||
          remote.occupiedByTeamId !== local.occupiedByTeamId
        ) {
          state.stationOccupancy[id] = { ...remote };
          changed = true;
        }
      }
    });
  }

  if (teamAssignments) {
    state.teams.forEach((team) => {
      const remoteStation = teamAssignments[team.id];
      if (remoteStation !== undefined && remoteStation !== team.currentStationId) {
        team.currentStationId = remoteStation;
        changed = true;
      }
    });
  }

  if (teamProgress) {
    state.teams.forEach((team) => {
      const remoteIds = teamProgress[team.id] || [];
      const currentIds = team.completedStationIds || [];
      const idsEqual =
        currentIds.length === remoteIds.length &&
        currentIds.every((id, i) => id === remoteIds[i]);
      if (!idsEqual) {
        // Don't overwrite local with stale remote: if we have more progress locally, keep it
        if (remoteIds.length >= currentIds.length) {
          team.completedStationIds = [...remoteIds];
          team.completed = remoteIds.length >= (state.maxStations ?? 5);
          changed = true;
        }
      }
    });
  }

  if (changed) {
    updateFinalUnlocked();
    if (
      state.activeTeamId &&
      !getTeamState(state.activeTeamId)?.currentStationId &&
      !getTeamState(state.activeTeamId)?.completed
    ) {
      const nextStation = assignNextStation(state.activeTeamId);
      if (nextStation) {
        occupyStation(nextStation.id, state.activeTeamId);
        assignTeamToStation(state.activeTeamId, nextStation.id);
        persistTeamStatusSyncPayload(state.activeTeamId);
      }
    }
    render();
  }
}

function applyRemoteTeamStatuses(teamStatuses) {
  if (!Array.isArray(teamStatuses) || teamStatuses.length === 0) {
    return;
  }
  const byTeamId = new Map(
    teamStatuses
      .filter((team) => team && team.teamId)
      .map((team) => [team.teamId, team])
  );
  let changed = false;
  state.teams = state.teams.map((team) => {
    const remote = byTeamId.get(team.id);
    if (!remote) {
      return team;
    }
    const remoteCount = Number.isFinite(remote.stepIndex) ? remote.stepIndex : getCompletedCount(team);
    const remoteCompleted =
      typeof remote.completed === "boolean"
        ? remote.completed
        : remoteCount >= (state.maxStations ?? 5);
    const currentCount = getCompletedCount(team);
    const completedStationIds = Array.isArray(team.completedStationIds) ? [...team.completedStationIds] : [];
    while (completedStationIds.length < remoteCount) {
      completedStationIds.push(STATION_IDS[completedStationIds.length]);
    }
    const completed = completedStationIds.length >= (state.maxStations ?? 5) || remoteCompleted;
    if (completedStationIds.length !== currentCount || completed !== team.completed) {
      changed = true;
    }
    return {
      ...team,
      completedStationIds,
      completed,
    };
  });
  if (changed) {
    updateFinalUnlocked();
    render();
  }
}

function updateFinalUnlocked() {
  const maxStations = state.maxStations ?? 5;
  const unlocked = state.teams.every(
    (team) => getCompletedCount(team) >= maxStations
  );
  if (unlocked && !state.finalUnlocked) {
    state.finalUnlocked = true;
    state.trivia.active = false;
    state.trivia.currentQuestionId = null;
    currentScreen = "final";
  }
  return state.finalUnlocked;
}

function getTeamState(teamId) {
  return state.teams.find((team) => team.id === teamId);
}

function getTeamData(teamId) {
  return appData.teams.find((team) => team.id === teamId);
}

function getStationData(stationId) {
  return appData.stations?.find((s) => s.id === stationId) ?? null;
}

function getPokemonForStationStep(teamState, stationId) {
  const pool = appData.pokemonPool;
  if (!pool.length) return null;
  if (teamState.stationPokemonChoices[stationId]) {
    const chosen = pool.find((p) => p.id === teamState.stationPokemonChoices[stationId]);
    if (chosen) return chosen;
  }
  const alreadyUsed = new Set(Object.values(teamState.stationPokemonChoices || {}));
  const unseen = pool.filter((p) => !alreadyUsed.has(p.id));
  const pickFrom = unseen.length > 0 ? unseen : pool;
  const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  if (!teamState.stationPokemonChoices) teamState.stationPokemonChoices = {};
  teamState.stationPokemonChoices[stationId] = chosen.id;
  return chosen;
}

function getCompletedCount(teamState) {
  return teamState?.completedStationIds?.length ?? 0;
}

function getTeamsForInstantSync() {
  return state.teams.map((t) => ({
    id: t.id,
    stepIndex: getCompletedCount(t),
    completed: t.completed,
  }));
}

/**
 * Ensures each of the 4 teams has a unique starting station (random permutation of 4 of 5 stations).
 * Writes to InstantDB so all devices see the same assignment. Call when Start Game is clicked.
 */
function assignInitialStationsIfNeeded() {
  const teamIds = state.teams.map((t) => t.id);
  if (teamIds.length !== 4) return;

  const hasOrder = Array.isArray(state.initialStationOrder) && state.initialStationOrder.length === 4;

  if (hasOrder) {
    for (let i = 0; i < 4; i++) {
      const team = state.teams[i];
      const stationId = state.initialStationOrder[i];
      if (!team.currentStationId && stationId) {
        state.stationOccupancy[stationId] = { state: "occupied", occupiedByTeamId: team.id };
        team.currentStationId = stationId;
        occupyStation(stationId, team.id);
        assignTeamToStation(team.id, stationId);
      }
    }
    return;
  }

  const shuffled = [...STATION_IDS].sort(() => Math.random() - 0.5);
  const order = shuffled.slice(0, 4);
  writeInitialStationAssignment(teamIds, order);
  state.initialStationOrder = order;
  for (let i = 0; i < 4; i++) {
    const stationId = order[i];
    const teamId = teamIds[i];
    state.stationOccupancy[stationId] = { state: "occupied", occupiedByTeamId: teamId };
    const team = state.teams.find((t) => t.id === teamId);
    if (team) team.currentStationId = stationId;
  }
}

function assignNextStation(teamId) {
  const teamState = getTeamState(teamId);
  if (!teamState || teamState.completed) return null;
  const completedSet = new Set(teamState.completedStationIds || []);
  const remaining = STATION_IDS.filter((id) => !completedSet.has(id));
  const available = remaining.filter(
    (id) => state.stationOccupancy[id]?.state === "open"
  );
  if (available.length === 0) return null;
  const chosen = available[Math.floor(Math.random() * available.length)];
  state.stationOccupancy[chosen] = { state: "occupied", occupiedByTeamId: teamId };
  teamState.currentStationId = chosen;
  occupyStation(chosen, teamId);
  assignTeamToStation(teamId, chosen);
  return getStationData(chosen);
}

function persistTeamStatusSyncPayload(teamId) {
  const teamState = getTeamState(teamId);
  if (!teamState) return;
  persistTeamStatus({
    id: teamState.id,
    stepIndex: getCompletedCount(teamState),
    completed: teamState.completed,
  });
}

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveImageUrl(path) {
  if (!path || typeof path !== "string") return "";
  if (/^https?:\/\//i.test(path)) return path;
  // Resolve relative to current document so images work from any server root (e.g. / or /app/)
  const pathname = window.location.pathname || "/";
  const docDir = pathname.endsWith("/") ? pathname : pathname.replace(/\/[^/]*$/, "/");
  const base = window.location.origin + docDir;
  const relativePath = path.replace(/^\.?\//, "");
  return new URL(relativePath, base).href;
}

function contactButtonMarkup(isBlock = false) {
  const blockClass = isBlock ? " block" : "";
  return `<a class="button secondary${blockClass}" href="tel:2036094570">Contact Austin</a>`;
}

function render() {
  updateFinalUnlocked();
  if (state.trivia.active) {
    renderTrivia();
    saveState(state);
    return;
  }

  if (currentScreen === "final") {
    renderFinalClue();
    saveState(state);
    return;
  }

  if (currentScreen === "teamPicker") {
    renderTeamPicker();
    saveState(state);
    return;
  }

  if (currentScreen === "assignTeams") {
    renderAssignTeams();
    saveState(state);
    return;
  }

  if (state.activeTeamId) {
    const teamState = getTeamState(state.activeTeamId);
    if (teamState && teamState.completed) {
      renderTeamCompleted(teamState);
    } else if (teamState?.currentStationId) {
      renderStationScreen();
    } else {
      renderWaitingOrAssignStation();
    }
    saveState(state);
    return;
  }

  renderHome();
  saveState(state);
}

function renderHome() {
  const hasProgress = state.teams.some((team) => getCompletedCount(team) > 0);
  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <h1 class="title">${appData.config.appTitle}</h1>
      <p class="subtitle">Choose a team, solve riddles, and unlock the final clue.</p>
      <div class="card">
        <button class="button block" data-action="start-game">Start Game</button>
        <div class="spacer"></div>
        <button class="button secondary block" data-action="resume-game" ${
          hasProgress ? "" : "disabled"
        }>Resume Game</button>
        <div class="spacer"></div>
        <button class="button secondary block" data-action="assign-teams">Assign Teams</button>
      </div>
      <div class="card">
        <button class="button secondary block" data-action="reset-game">Reset Game</button>
      </div>
    </section>
  `;
}

function renderTeamPicker() {
  if (
    !resetTeamId ||
    !appData.teams.some((team) => team.id === resetTeamId)
  ) {
    resetTeamId = appData.teams[0]?.id ?? null;
  }
  const maxStations = state.maxStations ?? 5;
  const teamCards = appData.teams
    .map((team) => {
      const teamState = getTeamState(team.id);
      const progress = `${getCompletedCount(teamState)}/${maxStations}`;
      const status = teamState.completed ? "Completed" : "In Progress";
      const assignedNames = state.assignments?.teams?.[team.id] || [];
      const namesMarkup = assignedNames.length
        ? `<ul class="name-list">${assignedNames
            .map((name) => `<li>${escapeHtml(name)}</li>`)
            .join("")}</ul>`
        : `<p class="muted">No team members yet.</p>`;
      return `
        <div class="card team-card ${team.id}">
          <h3>${team.name}</h3>
          <p class="muted">Progress: ${progress} - ${status}</p>
          ${namesMarkup}
          <button class="button block" data-action="pick-team" data-team="${team.id}">Open Team</button>
        </div>
      `;
    })
    .join("");

  const finalButton = state.finalUnlocked
    ? `<button class="button block" data-action="show-final">Show Final Clue</button>`
    : "";

  const resetTeamOptions = appData.teams
    .map(
      (team) =>
        `<option value="${team.id}" ${
          team.id === resetTeamId ? "selected" : ""
        }>${team.name} Team</option>`
    )
    .join("");

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <h1 class="title">Pick a Team</h1>
      ${teamCards}
      <div class="card">${finalButton}</div>
      <div class="card">
        <button class="button secondary block" data-action="assign-teams">Edit Team Assignments</button>
        <div class="spacer"></div>
        <label class="muted" for="reset-team-select">Reset a team's progress</label>
        <div class="spacer"></div>
        <select id="reset-team-select" class="input" data-input="reset-team">
          ${resetTeamOptions}
        </select>
        <div class="spacer"></div>
        <button class="button secondary block" data-action="reset-team-progress">Reset Team's Progress</button>
      </div>
      <button class="button secondary block" data-action="go-home">Back Home</button>
    </section>
  `;
}

function renderAssignTeams() {
  const existingNames = Array.isArray(state.assignments.names)
    ? [...state.assignments.names]
    : [];
  const inputs = existingNames.concat(
    Array.from(
      { length: Math.max(0, DEFAULT_NAME_INPUTS - existingNames.length) },
      () => ""
    )
  );
  const nameInputs = inputs
    .map(
      (value, index) => `
        <input
          class="input"
          data-input="kid-name"
          data-index="${index}"
          placeholder="First name"
          value="${escapeHtml(value)}"
          autocomplete="off"
        />
      `
    )
    .join("");
  const assigned = state.assignments.teams;
  const teamLists = appData.teams
    .map((team) => {
      const names = assigned?.[team.id] || [];
      return `
        <div class="card team-card ${team.id}">
          <h3>${team.name} Team</h3>
          ${
            names.length
              ? `<ul class="name-list">${names
                  .map((name) => `<li>${escapeHtml(name)}</li>`)
                  .join("")}</ul>`
              : `<p class="muted">No team members yet.</p>`
          }
        </div>
      `;
    })
    .join("");

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <h1 class="title">Assign Teams</h1>
      <div class="card">
        <p class="muted">Enter first names, then randomize teams.</p>
        <div class="name-grid">
          ${nameInputs}
        </div>
        <div class="spacer"></div>
        <div class="row">
          <button class="button" data-action="randomize-teams">Randomize Teams</button>
          <button class="button secondary" data-action="add-name-input">Add Name</button>
          <button class="button secondary" data-action="clear-assignments">Clear Names</button>
        </div>
      </div>
      ${teamLists}
      <button class="button secondary block" data-action="back-to-teams">Back to Teams</button>
      <button class="button secondary block" data-action="go-home">Back Home</button>
    </section>
  `;
}

function renderWaitingOrAssignStation() {
  const teamState = getTeamState(state.activeTeamId);
  const teamData = getTeamData(state.activeTeamId);
  const nextStation = assignNextStation(state.activeTeamId);
  if (nextStation) {
    persistTeamStatusSyncPayload(state.activeTeamId);
    renderStationScreen();
    return;
  }
  const completedCount = getCompletedCount(teamState);
  const maxStations = state.maxStations ?? 5;

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="card team-card ${teamData.id}">
        <h1 class="title">${teamData.name} Team</h1>
        <p class="muted">${completedCount} of ${maxStations} stations completed</p>
        <p>Waiting for next station to open…</p>
      </div>
      <div class="card">
        <button class="button block" data-action="start-trivia">Play Trivia</button>
      </div>
      <div class="card">
        <button class="button secondary block" data-action="retry-assign-station">Check for Available Station</button>
      </div>
      <button class="button secondary block" data-action="back-to-teams">Back to Teams</button>
    </section>
  `;
}

function renderStationScreen() {
  const teamState = getTeamState(state.activeTeamId);
  const teamData = getTeamData(state.activeTeamId);
  const station = getStationData(teamState.currentStationId);
  if (!station) {
    renderWaitingOrAssignStation();
    return;
  }
  const displayPokemon =
    getPokemonForStationStep(teamState, station.id) ||
    {
      name: station.pokemon || "",
      image: station.image || null,
      trivia: station.trivia || [],
    };
  const stepKey = `${teamData.id}-${station.id}`;
  const completedCount = getCompletedCount(teamState);
  const maxStations = state.maxStations ?? 5;

  if (codeClueState.stepKey !== stepKey) {
    codeClueState = { revealed: false, stepKey };
    codeClueFeedback = null;
  }

  const triviaMarkup = displayPokemon.trivia?.length
    ? `
    <div class="card step-trivia">
      <details>
        <summary>Trivia (Read Aloud)</summary>
        <div class="step-trivia-content">
          ${displayPokemon.trivia
            .map(
              (item, index) =>
                `<p><strong>Q${index + 1}:</strong> ${escapeHtml(item.question)}<br /><strong>A:</strong> ${escapeHtml(item.answer)}</p>`
            )
            .join("")}
        </div>
      </details>
    </div>
    `
    : "";

  const howToPlayMarkup = Array.isArray(station.howToPlay)
    ? `<ol>${station.howToPlay.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
    : "";

  const musicButtonMarkup =
    station.id === "D" && station.musicLink
      ? `<a class="button secondary block" href="${escapeHtml(station.musicLink)}" target="_blank" rel="noopener noreferrer">Play Pokémon Theme Song</a>`
      : "";

  const stationInfoMarkup = `
    <div class="card station-info-tile">
      <h3>Station ${station.id}: ${escapeHtml(station.name)} — ${escapeHtml(station.zone)}</h3>
      <p><strong>Clue:</strong> ${escapeHtml(station.clue)}</p>
      <p><strong>Setup:</strong> ${escapeHtml(station.setup || "")}</p>
      ${howToPlayMarkup ? `<p><strong>How to Play:</strong></p>${howToPlayMarkup}` : ""}
      <p><strong>Win Condition:</strong> ${escapeHtml(station.winCondition || "")}</p>
      <p><strong>Reset:</strong> ${escapeHtml(station.reset || "")}</p>
      ${station.parentTip ? `<p class="muted"><strong>Parent Tip:</strong> ${escapeHtml(station.parentTip)}</p>` : ""}
      ${musicButtonMarkup ? `<div class="spacer"></div>${musicButtonMarkup}` : ""}
    </div>
  `;

  const findTheCodePoemMarkup = station.findCodePoem
    ? station.findCodePoem
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("<br />")
    : "";
  const findTheCodeMarkup =
    findTheCodePoemMarkup || station.findCodeParentHint
      ? `
    <div class="card find-the-code-section">
      <details>
        <summary>Find the Code!</summary>
        ${findTheCodePoemMarkup ? `<p class="find-the-code-poem">${findTheCodePoemMarkup}</p>` : ""}
        ${station.findCodeParentHint ? `<p class="muted"><strong>Parent hint:</strong> ${escapeHtml(station.findCodeParentHint)}</p>` : ""}
      </details>
    </div>
  `
      : "";

  const riddleMarkup = station.riddle
    ? station.riddle
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("<br />")
    : "";
  const riddleBlockMarkup =
    riddleMarkup &&
    `<div class="step-riddle">
      <p class="step-riddle-label">Where to find this station:</p>
      <p class="step-riddle-text">${riddleMarkup}</p>
    </div>`;

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="step-grid">
        <div class="card team-card ${teamData.id} step-main step-pokemon">
          <div class="step-main-header">
            <div class="step-main-text">
              <h1 class="title">${teamData.name} Team</h1>
              <p class="muted">${completedCount} of ${maxStations} stations completed</p>
              ${completedCount >= 1 ? `<p class="step-next-battle-msg">Good catch Trainers! Now is your next battle!</p>` : ""}
              <div class="pill">Pokemon: ${escapeHtml(displayPokemon.name || "")}</div>
            </div>
            ${
              displayPokemon.image
                ? `<img class="pokemon-image" src="${escapeHtml(resolveImageUrl(displayPokemon.image))}" alt="${escapeHtml(displayPokemon.name || "Pokemon")}" />`
                : ""
            }
          </div>
          ${riddleBlockMarkup || ""}
        </div>
        ${triviaMarkup}
        ${stationInfoMarkup}
        ${findTheCodeMarkup}
        <div class="card step-code-entry">
          <form data-form="code-entry">
            <label for="code-input" class="muted">Enter code from the target:</label>
            <div class="spacer"></div>
            <input id="code-input" class="input" autocomplete="off" />
            <div class="spacer"></div>
            <button class="button block" type="submit">Unlock Next Clue</button>
          </form>
          ${
            feedback
              ? `<p class="${feedback.type === "ok" ? "status-ok" : "status-warn"}">${feedback.text}</p>`
              : ""
          }
        </div>
        <div class="card step-code-clue">
          <h3>Code Clue</h3>
          <p class="muted">For the parent/guide if you get stuck.</p>
          ${
            codeClueState.revealed
              ? `
                <div class="code-clue">
                  <div class="code-value">${escapeHtml(station.code)}</div>
                  <button class="button secondary block" data-action="copy-code">Copy Code</button>
                </div>
              `
              : `<button class="button secondary block" data-action="reveal-code">Show Code</button>`
          }
          ${
            codeClueFeedback
              ? `<p class="${codeClueFeedback.type === "ok" ? "status-ok" : "status-warn"}">${codeClueFeedback.text}</p>`
              : ""
          }
        </div>
      </div>
      <div class="step-actions row">
        <button class="button secondary" data-action="back-to-teams">Back to Teams</button>
        ${contactButtonMarkup()}
      </div>
    </section>
  `;
}

function renderTeamCompleted(teamState) {
  const teamData = getTeamData(teamState.id);
  const maxStations = state.maxStations ?? 5;
  const progressList = state.teams
    .map((team) => {
      return `<li>${team.name}: ${getCompletedCount(team)}/${maxStations}</li>`;
    })
    .join("");

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="card team-card ${teamData.id}">
        <h1 class="title">${teamData.name} Team Completed!</h1>
        <p class="muted">Waiting for other teams...</p>
      </div>
      <div class="card">
        <h3>All Team Progress</h3>
        <ul>${progressList}</ul>
      </div>
      <div class="card">
        <button class="button block" data-action="start-trivia">Play Trivia</button>
      </div>
      <div class="card">
        ${contactButtonMarkup(true)}
      </div>
      <button class="button secondary block" data-action="back-to-teams">Back to Teams</button>
    </section>
  `;
}

function renderTrivia() {
  let question = pickQuestionById(
    appData.trivia,
    state.trivia.currentQuestionId
  );
  if (!question) {
    question = getRandomQuestion(appData.trivia, state.trivia.usedQuestionIds);
    state.trivia.currentQuestionId = question.id;
    if (!state.trivia.usedQuestionIds.includes(question.id)) {
      state.trivia.usedQuestionIds.push(question.id);
    }
  }

  const shuffledOptions = shuffleArray([...question.options]);
  const optionsMarkup = shuffledOptions
    .map(
      (option) =>
        `<button class="button secondary block" data-action="trivia-answer" data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>`
    )
    .join("");

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="card">
        <h1 class="title">Who's that Pokemon?</h1>
        <p class="muted">${question.prompt}</p>
        ${question.image ? `<img src="${question.image}" alt="Pokemon silhouette" class="card" />` : ""}
      </div>
      <div class="card option-grid">
        ${optionsMarkup}
      </div>
      ${
        triviaFeedback
          ? `<p class="${triviaFeedback.type === "ok" ? "status-ok" : "status-warn"}">${triviaFeedback.text}</p>`
          : ""
      }
      <div class="card">
        <button class="button block" data-action="next-trivia">Next Question</button>
      </div>
      <div class="card">
        ${contactButtonMarkup(true)}
      </div>
      <button class="button secondary block" data-action="back-to-teams">Back to Teams</button>
    </section>
  `;
}

function renderFinalClue() {
  const finalClue = appData.config.finalClue;
  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="card center">
        <h1 class="title">${finalClue.title}</h1>
        ${
          finalClue.image
            ? `<img class="pokemon-image" src="${finalClue.image}" alt="Mewtwo" />`
            : ""
        }
        <p>${finalClue.riddle}</p>
        ${finalClue.hint ? `<p class="muted">Hint: ${finalClue.hint}</p>` : ""}
      </div>
      <div class="card">
        ${contactButtonMarkup(true)}
      </div>
      <button class="button secondary block" data-action="go-home">Back Home</button>
    </section>
  `;
}

function handleCodeSubmit() {
  const input = document.getElementById("code-input");
  if (!input) return;
  const entered = normalizeCode(input.value);
  const teamState = getTeamState(state.activeTeamId);
  const station = getStationData(teamState.currentStationId);
  if (!station) return;
  const expected = normalizeCode(station.code);

  if (entered && entered === expected) {
    const stationId = teamState.currentStationId;
    teamState.completedStationIds.push(stationId);
    teamState.completed = teamState.completedStationIds.length >= (state.maxStations ?? 5);
    state.stationOccupancy[stationId] = { state: "open", occupiedByTeamId: null };
    teamState.currentStationId = null;
    releaseStation(stationId);
    completeStationForTeam(state.activeTeamId, stationId);
    clearTeamAssignment(state.activeTeamId);

    if (teamState.completed) {
      persistTeamStatusSyncPayload(state.activeTeamId);
      persistAllTeamStatuses(getTeamsForInstantSync());
      feedback = { type: "ok", text: "Nice throw! You caught it!" };
      input.value = "";
      updateFinalUnlocked();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        feedback = null;
        render();
      }, 1200);
      return;
    }

    const nextStation = assignNextStation(state.activeTeamId);
    if (nextStation) {
      persistTeamStatusSyncPayload(state.activeTeamId);
      feedback = { type: "ok", text: "Nice throw! You caught it!" };
      input.value = "";
    } else {
      feedback = { type: "ok", text: "Nice throw! You caught it!" };
      input.value = "";
    }
  } else {
    feedback = { type: "warn", text: "Not quite—check the code on the back!" };
  }
  updateFinalUnlocked();
  render();
  if (entered && entered === expected) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  setTimeout(() => {
    feedback = null;
    render();
  }, 1200);
}

function resetProgress() {
  state.teams = state.teams.map((team) => ({
    ...team,
    completedStationIds: [],
    currentStationId: null,
    completed: false,
  }));
  STATION_IDS.forEach((id) => {
    state.stationOccupancy[id] = { state: "open", occupiedByTeamId: null };
  });
  state.initialStationOrder = null;
  clearAllStationData();
  state.teams.forEach((t) => {
    clearTeamAssignment(t.id);
    clearTeamProgress(t.id);
  });
  clearInitialStationAssignment();
  persistAllTeamStatuses(getTeamsForInstantSync());
  state.activeTeamId = null;
  state.finalUnlocked = false;
  state.trivia = {
    active: false,
    currentQuestionId: null,
    usedQuestionIds: [],
  };
  feedback = null;
  triviaFeedback = null;
  codeClueState = { revealed: false, stepKey: null };
  codeClueFeedback = null;
  codeSuccessNextStation = null;
}

function resetTeamProgress(teamId) {
  const teamState = getTeamState(teamId);
  if (!teamState) return;
  const currentStationId = teamState.currentStationId;
  if (currentStationId) {
    state.stationOccupancy[currentStationId] = { state: "open", occupiedByTeamId: null };
    releaseStation(currentStationId);
  }
  teamState.completedStationIds = [];
  teamState.currentStationId = null;
  teamState.completed = false;
  teamState.stationPokemonChoices = {};
  clearTeamAssignment(teamId);
  clearTeamProgress(teamId);
  persistTeamStatusSyncPayload(teamId);
  if (state.activeTeamId === teamId) {
    state.activeTeamId = null;
    codeSuccessNextStation = null;
  }
  const maxStations = state.maxStations ?? 5;
  state.finalUnlocked = state.teams.every((team) => getCompletedCount(team) >= maxStations);
  feedback = null;
  triviaFeedback = null;
  codeClueState = { revealed: false, stepKey: null };
  codeClueFeedback = null;
}

function addNameInput() {
  if (!Array.isArray(state.assignments.names)) {
    state.assignments.names = [];
  }
  state.assignments.names.push("");
}

function updateNameAtIndex(index, value) {
  if (!Array.isArray(state.assignments.names)) {
    state.assignments.names = [];
  }
  state.assignments.names[index] = value;
}

function clearAssignments() {
  state.assignments.names = [];
  state.assignments.teams = buildEmptyAssignments(appData.teams).teams;
}

function shuffleArray(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function randomizeTeams() {
  const cleanedNames = (state.assignments.names || [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const shuffled = shuffleArray([...cleanedNames]);
  const assignments = buildEmptyAssignments(appData.teams).teams;
  shuffled.forEach((name, index) => {
    const team = appData.teams[index % appData.teams.length];
    assignments[team.id].push(name);
  });
  state.assignments.teams = assignments;
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

async function handleCopyCodeClue() {
  const teamState = getTeamState(state.activeTeamId);
  const station = getStationData(teamState.currentStationId);
  if (!station) return;
  try {
    const ok = await copyTextToClipboard(station.code);
    codeClueFeedback = ok
      ? { type: "ok", text: "Code copied!" }
      : { type: "warn", text: "Copy failed. Please select it manually." };
  } catch (error) {
    console.warn("Copy failed.", error);
    codeClueFeedback = {
      type: "warn",
      text: "Copy failed. Please select it manually.",
    };
  }
  render();
  setTimeout(() => {
    codeClueFeedback = null;
    render();
  }, 1200);
}

function startTrivia() {
  state.trivia.active = true;
  triviaFeedback = null;
  if (state.trivia.usedQuestionIds.length >= appData.trivia.length) {
    state.trivia.usedQuestionIds = [];
  }
  const question = getRandomQuestion(appData.trivia, state.trivia.usedQuestionIds);
  state.trivia.currentQuestionId = question.id;
  if (!state.trivia.usedQuestionIds.includes(question.id)) {
    state.trivia.usedQuestionIds.push(question.id);
  }
  render();
}

function handleTriviaAnswer(answer) {
  const question = pickQuestionById(
    appData.trivia,
    state.trivia.currentQuestionId
  );
  if (!question) {
    return;
  }
  triviaFeedback =
    answer === question.answer
      ? { type: "ok", text: "Correct!" }
      : { type: "warn", text: `Oops! It was ${question.answer}.` };
  render();
}

function nextTriviaQuestion() {
  triviaFeedback = null;
  if (state.trivia.usedQuestionIds.length >= appData.trivia.length) {
    state.trivia.usedQuestionIds = [];
  }
  const question = getRandomQuestion(appData.trivia, state.trivia.usedQuestionIds);
  state.trivia.currentQuestionId = question.id;
  if (!state.trivia.usedQuestionIds.includes(question.id)) {
    state.trivia.usedQuestionIds.push(question.id);
  }
  render();
}

appEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;
  if (action === "start-game" || action === "resume-game") {
    currentScreen = "teamPicker";
    assignInitialStationsIfNeeded();
    render();
    return;
  }

  if (action === "assign-teams") {
    currentScreen = "assignTeams";
    render();
    return;
  }

  if (action === "reset-game") {
    const ok = window.confirm("Reset all progress?");
    if (ok) {
      clearAllStationData();
      state.teams.forEach((t) => {
        clearTeamAssignment(t.id);
        clearTeamProgress(t.id);
      });
      clearInitialStationAssignment();
      clearState();
      state = buildInitialState(appData.teams, appData.stations, appData.config);
      persistAllTeamStatuses(getTeamsForInstantSync());
      currentScreen = "home";
      render();
    }
    return;
  }

  if (action === "reset-team-progress") {
    const selectedTeamId = resetTeamId;
    const teamData = selectedTeamId ? getTeamData(selectedTeamId) : null;
    if (!teamData) {
      window.alert("Choose a team to reset.");
      return;
    }
    const ok = window.confirm(
      `Reset ${teamData.name} Team's progress back to zero?`
    );
    if (ok) {
      resetTeamProgress(selectedTeamId);
      currentScreen = "teamPicker";
      render();
    }
    return;
  }

  if (action === "pick-team") {
    state.activeTeamId = target.dataset.team;
    codeSuccessNextStation = null;
    currentScreen = "team";
    render();
    return;
  }

  if (action === "go-to-next-station") {
    codeSuccessNextStation = null;
    render();
    return;
  }

  if (action === "retry-assign-station") {
    const nextStation = assignNextStation(state.activeTeamId);
    if (nextStation) {
      persistTeamStatusSyncPayload(state.activeTeamId);
    }
    render();
    return;
  }

  if (action === "back-to-teams") {
    state.activeTeamId = null;
    state.trivia.active = false;
    currentScreen = "teamPicker";
    render();
    return;
  }

  if (action === "start-trivia") {
    startTrivia();
    return;
  }

  if (action === "next-trivia") {
    nextTriviaQuestion();
    return;
  }

  if (action === "trivia-answer") {
    handleTriviaAnswer(target.dataset.answer);
    return;
  }

  if (action === "reveal-code") {
    codeClueState.revealed = true;
    codeClueFeedback = null;
    render();
    return;
  }

  if (action === "copy-code") {
    handleCopyCodeClue();
    return;
  }

  if (action === "show-final") {
    state.finalUnlocked = true;
    currentScreen = "final";
    render();
    return;
  }

  if (action === "go-home") {
    state.activeTeamId = null;
    state.trivia.active = false;
    currentScreen = "home";
    render();
  }

  if (action === "randomize-teams") {
    randomizeTeams();
    render();
    return;
  }

  if (action === "add-name-input") {
    addNameInput();
    render();
    return;
  }

  if (action === "clear-assignments") {
    const ok = window.confirm("Clear all saved names and assignments?");
    if (ok) {
      clearAssignments();
      render();
    }
  }
});

appEl.addEventListener("submit", (event) => {
  if (event.target.matches("[data-form='code-entry']")) {
    event.preventDefault();
    handleCodeSubmit();
  }
});

appEl.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-input='kid-name']")) {
    const index = Number.parseInt(target.dataset.index, 10);
    updateNameAtIndex(index, target.value);
    saveState(state);
    return;
  }
  if (target.matches("[data-input='reset-team']")) {
    resetTeamId = target.value;
  }
});
