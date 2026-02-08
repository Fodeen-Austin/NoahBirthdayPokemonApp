import { loadState, saveState, clearState } from "./storage.js";
import { getRandomQuestion, pickQuestionById } from "./trivia.js";
import {
  initInstant,
  persistAllTeamStatuses,
  persistTeamStatus,
} from "./instant.js";

const appEl = document.getElementById("app");

const appData = {
  config: null,
  teams: [],
  trivia: [],
};

let state = null;
let currentScreen = "home";
let feedback = null;
let triviaFeedback = null;
let codeClueState = { revealed: false, stepKey: null };
let codeClueFeedback = null;
let resetTeamId = null;
let instantStatus = { state: "idle", text: "InstantDB: connecting..." };

const DEFAULT_NAME_INPUTS = 12;

init();

async function init() {
  await loadData();
  state = normalizeState(
    loadState() || buildInitialState(appData.teams, appData.config),
    appData.teams,
    appData.config
  );
  if (!resetTeamId && appData.teams.length) {
    resetTeamId = appData.teams[0].id;
  }
  initInstant(
    appData.config.instantAppId,
    state.teams,
    applyRemoteTeamStatuses,
    handleInstantStatus
  );
  if (state.finalUnlocked) {
    currentScreen = "final";
  }
  updateFinalUnlocked();
  render();
}

async function loadData() {
  const [config, teams, trivia] = await Promise.all([
    fetch("./data/config.json").then((res) => res.json()),
    fetch("./data/teams.json").then((res) => res.json()),
    fetch("./data/trivia.json").then((res) => res.json()),
  ]);
  appData.config = config;
  appData.teams = teams;
  appData.trivia = trivia;
  document.title = config.appTitle;
}

function buildInitialState(teams, config) {
  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      stepIndex: 0,
      completed: false,
    })),
    activeTeamId: null,
    finalUnlocked: false,
    trivia: {
      active: false,
      currentQuestionId: null,
      usedQuestionIds: [],
    },
    maxSteps: config.maxSteps,
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

function normalizeState(loadedState, teams, config) {
  const normalized = { ...loadedState };
  normalized.maxSteps = config.maxSteps;
  normalized.teams = teams.map((team, index) => {
    const existing = loadedState.teams?.[index];
    return {
      id: team.id,
      name: team.name,
      stepIndex: existing?.stepIndex ?? 0,
      completed: existing?.completed ?? false,
    };
  });
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
    const stepIndex = Number.isFinite(remote.stepIndex)
      ? remote.stepIndex
      : team.stepIndex;
    const completed =
      typeof remote.completed === "boolean"
        ? remote.completed
        : stepIndex >= state.maxSteps;
    if (stepIndex !== team.stepIndex || completed !== team.completed) {
      changed = true;
    }
    return {
      ...team,
      stepIndex,
      completed,
    };
  });
  if (changed) {
    updateFinalUnlocked();
    render();
  }
}

function updateFinalUnlocked() {
  const unlocked = state.teams.every(
    (team) => team.stepIndex >= state.maxSteps
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

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    } else {
      renderTeamScreen();
    }
    saveState(state);
    return;
  }

  renderHome();
  saveState(state);
}

function renderHome() {
  const hasProgress = state.teams.some((team) => team.stepIndex > 0);
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
  const teamCards = appData.teams
    .map((team) => {
      const teamState = getTeamState(team.id);
      const progress = `${teamState.stepIndex}/${state.maxSteps}`;
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

function renderTeamScreen() {
  const teamState = getTeamState(state.activeTeamId);
  const teamData = getTeamData(state.activeTeamId);
  const stepIndex = teamState.stepIndex;
  const stepData = teamData.steps[stepIndex];
  const stepKey = `${teamData.id}-${stepIndex}`;
  const triviaMarkup = stepData.trivia?.length
    ? `
      <div class="card">
        <h3>Trivia (Read Aloud)</h3>
        ${stepData.trivia
          .map(
            (item, index) => `
              <p><strong>Q${index + 1}:</strong> ${item.question}<br /><strong>A:</strong> ${item.answer}</p>
            `
          )
          .join("")}
      </div>
    `
    : "";

  if (codeClueState.stepKey !== stepKey) {
    codeClueState = { revealed: false, stepKey };
    codeClueFeedback = null;
  }

  appEl.innerHTML = `
    <section class="screen">
      ${statusIndicatorMarkup()}
      <div class="step-grid">
        <div class="card team-card ${teamData.id} step-main">
          <div class="step-main-header">
            <div class="step-main-text">
              <h1 class="title">${teamData.name} Team</h1>
              <p class="muted">Step ${stepIndex + 1} of ${state.maxSteps}</p>
              <div class="pill">Pokemon: ${stepData.pokemon}</div>
            </div>
            ${
              stepData.image
                ? `<img class="pokemon-image" src="${stepData.image}" alt="${stepData.pokemon}" />`
                : ""
            }
          </div>
          <div class="step-main-clue">
            <p>${stepData.riddle}</p>
            ${stepData.hint ? `<p class="muted">Hint: ${stepData.hint}</p>` : ""}
          </div>
        </div>
        <div class="step-trivia">
          ${triviaMarkup}
        </div>
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
                  <div class="code-value">${stepData.code}</div>
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
  const progressList = state.teams
    .map((team) => {
      return `<li>${team.name}: ${team.stepIndex}/${state.maxSteps}</li>`;
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

  const optionsMarkup = question.options
    .map(
      (option) =>
        `<button class="button secondary block" data-action="trivia-answer" data-answer="${option}">${option}</button>`
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
  if (!input) {
    return;
  }
  const entered = normalizeCode(input.value);
  const teamState = getTeamState(state.activeTeamId);
  const teamData = getTeamData(state.activeTeamId);
  const expected = normalizeCode(teamData.steps[teamState.stepIndex].code);

  if (entered && entered === expected) {
    teamState.stepIndex += 1;
    teamState.completed = teamState.stepIndex >= state.maxSteps;
    persistTeamStatus(teamState);
    feedback = { type: "ok", text: "Nice throw! You caught it!" };
    input.value = "";
  } else {
    feedback = { type: "warn", text: "Not quite—check the code on the back!" };
  }
  updateFinalUnlocked();
  render();
  setTimeout(() => {
    feedback = null;
    render();
  }, 1200);
}

function resetProgress() {
  state.teams = state.teams.map((team) => ({
    ...team,
    stepIndex: 0,
    completed: false,
  }));
  persistAllTeamStatuses(state.teams);
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
}

function resetTeamProgress(teamId) {
  const teamState = getTeamState(teamId);
  if (!teamState) {
    return;
  }
  teamState.stepIndex = 0;
  teamState.completed = false;
  persistTeamStatus(teamState);
  if (state.activeTeamId === teamId) {
    state.activeTeamId = null;
  }
  state.finalUnlocked = state.teams.every(
    (team) => team.stepIndex >= state.maxSteps
  );
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
  const teamData = getTeamData(state.activeTeamId);
  const stepData = teamData.steps[teamState.stepIndex];
  try {
    const ok = await copyTextToClipboard(stepData.code);
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
      clearState();
      state = buildInitialState(appData.teams, appData.config);
      persistAllTeamStatuses(state.teams);
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
    currentScreen = "team";
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
