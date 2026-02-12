const STORAGE_URL_KEY = "flashcards_sheet_url";
const STORAGE_GID_KEY = "flashcards_sheet_gid";
const STORAGE_THEME_KEY = "flashcards_theme";
const STORAGE_SAVED_DECKS_KEY = "flashcards_saved_decks";

const THEMES = {
  warm: {
    bgTop: "#f7f1e7",
    bgBottom: "#ece4d8",
    panel: "#fffaf2",
    ink: "#1f2d2a",
    accent: "#ce5a3a",
    accentDark: "#9f4329",
    muted: "#66756f",
    line: "#dfd4c4",
    cardBack: "#3f4f49"
  },
  ocean: {
    bgTop: "#e9f5ff",
    bgBottom: "#d3e8f5",
    panel: "#f6fcff",
    ink: "#183143",
    accent: "#2376b7",
    accentDark: "#185d95",
    muted: "#4e6a7c",
    line: "#c4dae9",
    cardBack: "#295269"
  },
  forest: {
    bgTop: "#edf5ea",
    bgBottom: "#dcebd8",
    panel: "#f8fdf6",
    ink: "#1f3524",
    accent: "#3f8a4a",
    accentDark: "#2f6f3a",
    muted: "#5f7564",
    line: "#c9ddcb",
    cardBack: "#2f5134"
  },
  sunset: {
    bgTop: "#fff1e8",
    bgBottom: "#ffe0cf",
    panel: "#fff8f4",
    ink: "#3a2420",
    accent: "#df6b3f",
    accentDark: "#c2542c",
    muted: "#86645c",
    line: "#efd1c2",
    cardBack: "#74473d"
  }
};

const fallbackCards = [
  { front: "Photosynthesis", back: "Process plants use to convert light into chemical energy." },
  { front: "HTTP 404", back: "Status code meaning resource not found." },
  { front: "Mitochondria", back: "Organelles that produce ATP for the cell." },
  { front: "Pi", back: "Ratio of a circle's circumference to its diameter." },
  { front: "Refactor", back: "Improve code structure without changing behavior." },
  { front: "Inflation", back: "General increase in prices over time." },
  { front: "Osmosis", back: "Movement of water across a semipermeable membrane." },
  { front: "Git rebase", back: "Reapply commits onto a new base commit." },
  { front: "Photosphere", back: "Visible surface layer of the Sun." },
  { front: "Polymorphism", back: "Ability for objects to take multiple forms." }
];

let deck = [];
let current = 0;
let revealed = false;
let currentSpreadsheetId = "";

const sheetUrlInput = document.getElementById("sheetUrl");
const deckSelect = document.getElementById("deckSelect");
const themeSelect = document.getElementById("themeSelect");
const statusLabel = document.getElementById("status");
const frontText = document.getElementById("frontText");
const backText = document.getElementById("backText");
const indexLabel = document.getElementById("indexLabel");

const connectBtn = document.getElementById("connectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const flipBtn = document.getElementById("flipBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");

function safeGet(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

function getSavedDecks(spreadsheetId) {
  try {
    const all = JSON.parse(safeGet(STORAGE_SAVED_DECKS_KEY, "{}"));
    return all[spreadsheetId] || [];
  } catch {
    return [];
  }
}

function saveDeckTab(spreadsheetId, gid, name) {
  try {
    const all = JSON.parse(safeGet(STORAGE_SAVED_DECKS_KEY, "{}"));
    if (!all[spreadsheetId]) all[spreadsheetId] = [];
    if (!all[spreadsheetId].some(d => d.gid === gid)) {
      all[spreadsheetId].push({ gid, name });
      safeSet(STORAGE_SAVED_DECKS_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore storage errors.
  }
}

function suggestDeckName(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) return null;
  const firstRow = rows[0];
  const recognizedHeaders = [
    "front", "back", "term", "definition", "question", "answer",
    "prompt", "response", "word", "meaning", "italian", "english", "a", "b"
  ];
  const genericHeaders = ["front", "back", "a", "b"];
  const lower = firstRow.map(cell => cell.trim().toLowerCase());
  if (!lower.some(h => recognizedHeaders.includes(h))) return null;
  const meaningful = firstRow
    .map(cell => cell.trim())
    .filter(cell => cell && !genericHeaders.includes(cell.toLowerCase()));
  if (!meaningful.length) return null;
  return meaningful
    .map(h => h.charAt(0).toUpperCase() + h.slice(1).toLowerCase())
    .join(" / ");
}

function setStatus(message) {
  statusLabel.textContent = message;
  statusLabel.classList.remove("status-flash");
  void statusLabel.offsetWidth;
  statusLabel.classList.add("status-flash");
}

function applyTheme(themeName) {
  const key = THEMES[themeName] ? themeName : "warm";
  const theme = THEMES[key];
  const root = document.documentElement;

  root.style.setProperty("--bg-top", theme.bgTop);
  root.style.setProperty("--bg-bottom", theme.bgBottom);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--ink", theme.ink);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-dark", theme.accentDark);
  root.style.setProperty("--muted", theme.muted);
  root.style.setProperty("--line", theme.line);
  root.style.setProperty("--card-back", theme.cardBack);

  if (themeSelect) {
    themeSelect.value = key;
  }
  safeSet(STORAGE_THEME_KEY, key);
}

function parseSpreadsheetInfo(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      return null;
    }

    const id = match[1];
    const gidFromQuery = url.searchParams.get("gid");
    const gidFromHash = (url.hash.match(/gid=([0-9]+)/) || [])[1];
    const gid = gidFromQuery || gidFromHash || "0";
    return { id, gid };
  } catch {
    return null;
  }
}

function csvUrlForGid(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

function setFallbackDeck(message) {
  deck = [...fallbackCards];
  current = 0;
  revealed = false;
  setStatus(message);
  render();
}

function parseCsvRows(csvText) {
  const rows = [];
  let currentCell = "";
  let currentRow = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      currentRow.push(currentCell.trim());
      currentCell = "";
      if (currentRow.some(cell => cell.length)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length || currentRow.length) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell.length)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    return [];
  }

  const firstRow = rows[0].map(cell => cell.toLowerCase());
  const isHeader = value => [
    "front", "back", "term", "definition", "question", "answer", "prompt", "response",
    "word", "meaning", "italian", "english", "a", "b"
  ].includes(value);

  const frontHeaderCandidates = ["front", "term", "question", "prompt", "word", "italian", "a"];
  const backHeaderCandidates = ["back", "definition", "answer", "response", "meaning", "english", "b"];

  let frontCol = firstRow.findIndex(value => frontHeaderCandidates.includes(value));
  let backCol = firstRow.findIndex(value => backHeaderCandidates.includes(value));

  const hasRecognizedHeader = firstRow.some(isHeader);
  const startIndex = hasRecognizedHeader ? 1 : 0;

  if (frontCol === -1) {
    frontCol = 0;
  }

  if (backCol === -1 || backCol === frontCol) {
    backCol = frontCol === 0 ? 1 : 0;
  }

  const parsed = [];
  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    const front = (row[frontCol] || "").trim();
    const back = (row[backCol] || "").trim();

    if (!front || !back) {
      continue;
    }

    parsed.push({ front, back });
  }

  return parsed;
}

function renderDeckOptions(decks, preferredGid) {
  deckSelect.innerHTML = "";

  if (!decks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No tabs found";
    deckSelect.append(option);
    deckSelect.disabled = true;
    return;
  }

  deckSelect.disabled = false;

  for (const deckInfo of decks) {
    const option = document.createElement("option");
    option.value = deckInfo.gid;
    option.textContent = deckInfo.name;
    if (deckInfo.gid === preferredGid) {
      option.selected = true;
    }
    deckSelect.append(option);
  }

  if (![...deckSelect.options].some(opt => opt.selected)) {
    deckSelect.selectedIndex = 0;
  }
}

async function loadDeckByGid(spreadsheetId, gid, statusPrefix = "") {
  const csvUrl = csvUrlForGid(spreadsheetId, gid);
  const response = await fetch(csvUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const csv = await response.text();
  const parsed = parseCsv(csv);
  if (!parsed.length) {
    throw new Error("No valid cards found. Use any two populated columns (or headers like front/back). ");
  }

  deck = parsed;
  current = 0;
  revealed = false;
  safeSet(STORAGE_GID_KEY, gid);

  const selectedName = deckSelect.options[deckSelect.selectedIndex]?.text || `gid ${gid}`;
  setStatus(`${statusPrefix}Loaded ${deck.length} cards from deck: ${selectedName}.`);
  render();
}

function render() {
  if (!deck.length) {
    indexLabel.textContent = "Card 0/0";
    frontText.textContent = "No cards found";
    backText.textContent = "Use any two populated columns (for example A/B or front/back).";
    backText.classList.remove("hidden");
    return;
  }

  const card = deck[current];
  indexLabel.textContent = `Card ${current + 1}/${deck.length}`;
  frontText.textContent = card.front;
  backText.textContent = card.back;

  if (revealed) {
    backText.classList.remove("hidden");
  } else {
    backText.classList.add("hidden");
  }
}

function shuffleDeck() {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  current = 0;
  revealed = false;
  render();
}

function goNext() {
  if (!deck.length) {
    return;
  }
  current = (current + 1) % deck.length;
  revealed = false;
  render();
}

function goPrev() {
  if (!deck.length) {
    return;
  }
  current = (current - 1 + deck.length) % deck.length;
  revealed = false;
  render();
}

async function connectSheet() {
  const rawUrl = sheetUrlInput.value.trim();
  const info = parseSpreadsheetInfo(rawUrl);

  if (!info) {
    setFallbackDeck("Invalid Google Sheet URL. Using built-in sample deck.");
    return;
  }

  safeSet(STORAGE_URL_KEY, rawUrl);
  currentSpreadsheetId = info.id;

  let csvText;
  try {
    const csvUrl = csvUrlForGid(info.id, info.gid);
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    csvText = await response.text();
  } catch (error) {
    const savedDecks = getSavedDecks(info.id);
    if (savedDecks.length) renderDeckOptions(savedDecks, info.gid);
    setFallbackDeck(`Could not load deck. ${error.message}`);
    return;
  }

  const parsed = parseCsv(csvText);
  if (!parsed.length) {
    setFallbackDeck("No valid cards found.");
    return;
  }

  let savedDecks = getSavedDecks(info.id);
  const isNew = !savedDecks.some(d => d.gid === info.gid);
  if (isNew) {
    const name = suggestDeckName(csvText) || `Deck ${savedDecks.length + 1}`;
    saveDeckTab(info.id, info.gid, name);
    savedDecks = getSavedDecks(info.id);
  }

  renderDeckOptions(savedDecks, info.gid);

  deck = parsed;
  current = 0;
  revealed = false;
  safeSet(STORAGE_GID_KEY, info.gid);

  const selectedName = deckSelect.options[deckSelect.selectedIndex]?.text || `gid ${info.gid}`;
  const prefix = isNew ? "New deck added! " : "";
  setStatus(`${prefix}Loaded ${deck.length} cards from: ${selectedName}.`);
  render();
}

connectBtn.addEventListener("click", connectSheet);

sheetUrlInput.addEventListener("focus", () => {
  setTimeout(() => sheetUrlInput.select(), 0);
});

sheetUrlInput.addEventListener("paste", (e) => {
  const text = e.clipboardData ? e.clipboardData.getData("text") : "";
  if (text) {
    e.preventDefault();
    sheetUrlInput.value = text;
  }
  sheetUrlInput.classList.remove("input-flash");
  void sheetUrlInput.offsetWidth;
  sheetUrlInput.classList.add("input-flash");
  setTimeout(() => connectSheet(), 100);
});

refreshBtn.addEventListener("click", async () => {
  if (!currentSpreadsheetId) {
    await connectSheet();
    return;
  }

  try {
    await loadDeckByGid(currentSpreadsheetId, deckSelect.value || "0");
  } catch (error) {
    setFallbackDeck(`Refresh failed. ${error.message}`);
  }
});

deckSelect.addEventListener("change", async () => {
  if (!currentSpreadsheetId || !deckSelect.value) {
    return;
  }

  try {
    await loadDeckByGid(currentSpreadsheetId, deckSelect.value);
  } catch (error) {
    setFallbackDeck(`Could not switch deck. ${error.message}`);
  }
});

flipBtn.addEventListener("click", () => {
  revealed = !revealed;
  render();
});

nextBtn.addEventListener("click", goNext);
prevBtn.addEventListener("click", goPrev);
shuffleBtn.addEventListener("click", shuffleDeck);

if (themeSelect) {
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
}

(async function init() {
  applyTheme(safeGet(STORAGE_THEME_KEY, "warm"));

  const savedUrl = safeGet(STORAGE_URL_KEY, "");
  sheetUrlInput.value = savedUrl;

  if (savedUrl) {
    const info = parseSpreadsheetInfo(savedUrl);
    if (info) {
      currentSpreadsheetId = info.id;
      const savedDecks = getSavedDecks(info.id);
      if (savedDecks.length) {
        const preferredGid = safeGet(STORAGE_GID_KEY, "") || info.gid || "0";
        const gidToLoad = savedDecks.some(d => d.gid === preferredGid)
          ? preferredGid
          : savedDecks[0].gid;
        renderDeckOptions(savedDecks, gidToLoad);
        try {
          await loadDeckByGid(currentSpreadsheetId, gidToLoad);
        } catch (error) {
          setFallbackDeck(`Could not load deck. ${error.message}`);
        }
      } else {
        await connectSheet();
      }
    } else {
      setFallbackDeck("Saved URL is invalid. Using sample deck.");
    }
  } else {
    renderDeckOptions([{ name: "Sample Deck", gid: "fallback" }], "fallback");
    deckSelect.disabled = true;
    setFallbackDeck("Using built-in sample deck.");
  }
})();

