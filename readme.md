# Pokémon Park Scavenger Hunt Web App — Functional Specification (v1)

## 1) Purpose
A browser-based web app used at a city park birthday party to run a Pokémon-themed scavenger hunt.  
Kids complete **physical activities at stations** (throw Poké tennis ball at a target). A parent/guide then enters a **code printed on the back of the station target** into the app to unlock the next clue.

The app supports:
- 4 teams
- 5 stations per team (20 total station steps)
- A shared **Final (21st) clue** that unlocks only after all teams finish step 5
- A **Trivia Mode** for teams who finish early so kids stay engaged while waiting

This v1 is designed to run offline once loaded (no server required).

---

## 2) Users & Roles
### 2.1 Parent/Guide (Primary operator)
- Uses phone to select team, read riddles, validate station codes, and run trivia.

### 2.2 Kids (Players)
- Listen to riddles, find station targets, perform throwing activity, participate in trivia answers.

---

## 3) Game Setup (Pre-Party Configuration)
### 3.1 Teams
There are exactly 4 teams:
- Red
- Blue
- Green
- Yellow

Each team has:
- 5 steps (Step 1 → Step 5)
- A defined Pokémon character per step (used for theme & optional image)
- A riddle per step
- An expected “unlock code” per step (printed on physical station target)

### 3.2 Codes
- Each station has ONE code that unlocks the next clue.
- Codes are entered by Parent/Guide.
- Codes should be short, uppercase, no spaces (implementation should accept lower-case but normalize to uppercase).

Example format:
- `PIKA-HIT`, `SQUIRT-HIT`, `BENCH-3`, `TREE-OK`, etc.

### 3.3 Final Unlock
When all teams complete Step 5:
- App reveals the “Final (21st) clue” which directs everyone to the pavilion.
- Trivia Mode ends immediately and is replaced by the Final Clue screen.

---

## 4) Core Functional Requirements

### 4.1 App Start / Home
**FR-1:** App displays a Home screen with:
- Title: “Pokémon Park Quest”
- Buttons: “Start Game” / “Resume Game”
- Optional: “Reset Game” (with confirmation dialog)

**FR-2:** App should store state locally so refreshing the browser does not lose progress:
- Use LocalStorage (or IndexedDB) for persistence.

---

### 4.2 Team Selection
**FR-3:** User can choose one of four teams from a Team Picker screen:
- Red / Blue / Green / Yellow
- For each team show current step progress (0–5) and status:
  - “In Progress” (0–4)
  - “Completed” (5)

**FR-4:** Selecting a team opens that team’s current clue screen:
- If team step is 0, show Step 1 riddle.
- If team step is N (1–4), show Step (N+1) riddle.
- If team step is 5, show “Team Completed” screen with Trivia.

---

### 4.3 Display Current Clue (Riddle Screen)
**FR-5:** For the selected team, show:
- Team Name + Color
- Step number (1–5)
- Pokémon name (optional but fun)
- Riddle text
- Optional hint line (short)
- Code entry field
- “Unlock Next Clue” button

**FR-6:** Code entry behavior:
- On submit, normalize input (trim whitespace, uppercase).
- If correct:
  - advance team progress by 1
  - show a success animation/message: “Nice throw! You caught it!”
  - automatically navigate to the next riddle screen (unless just completed Step 5).
- If incorrect:
  - show error: “Not quite—check the code on the back!”
  - do NOT advance progress.

**FR-7:** Prevent skipping:
- Team can only unlock the next step by entering the correct code for the current step.

---

### 4.4 Team Completion (After Step 5)
**FR-8:** When a team completes Step 5:
- Mark team as completed
- Show “Team Completed” screen:
  - Congratulatory message
  - Status panel: “Waiting for other teams…”
  - A prominent “Play Trivia” button

**FR-9:** While waiting, show progress of all teams:
- Red: 0–5
- Blue: 0–5
- Green: 0–5
- Yellow: 0–5

---

### 4.5 Final Clue Unlock (21st Clue)
**FR-10:** App continuously checks if all teams are completed:
- Condition: Red=5 AND Blue=5 AND Green=5 AND Yellow=5

**FR-11:** When condition becomes true:
- Immediately show Final Clue screen (interrupt Trivia if running)
- Final Clue screen includes:
  - “Legendary Pokémon Appeared!”
  - Final riddle directing everyone to the pavilion
  - Optional: “Show Final Code” (or just show riddle only; final code can be physical at pavilion)
  - Optional: Confetti/sound

**FR-12:** Final Clue screen should be accessible from Home once unlocked.

---

## 5) Trivia Mode Requirements

### 5.1 Trivia Overview
Trivia mode is used ONLY after a team completes Step 5, while waiting for other teams.

**FR-13:** Trivia mode must:
- Contain a pool of ~20 questions
- Randomly select questions at runtime
- Present one question at a time
- Allow “Next Question”
- Support two question types:
  1) Text description → guess Pokémon
  2) Image prompt → guess Pokémon (multiple choice)

**FR-14:** Trivia mode ends automatically when Final Clue unlocks:
- If final unlock triggers while Trivia is displayed:
  - App immediately navigates to Final Clue screen.

---

### 5.2 Trivia Question Types

#### Type A: “Guess from Description”
**FR-15:** App displays:
- Title: “Who’s that Pokémon?”
- Description text
- Multiple choice buttons (3–4 options) OR a free-text input (choose one approach and implement consistently)

Preferred approach for 6-year-olds: multiple choice.

#### Type B: “Guess from Image”
**FR-16:** App displays:
- Pokémon image
- Multiple choice options (3–4)
- “Reveal Answer” optional
- “Next Question”

---

### 5.3 Trivia Question Pool Data Model
**FR-17:** Trivia questions are stored as a local JSON array.

Example schema:
```json
{
  "id": "q01",
  "type": "description",
  "prompt": "I’m yellow, electric, and Ash’s best friend.",
  "options": ["Pikachu", "Squirtle", "Eevee", "Meowth"],
  "answer": "Pikachu"
}
