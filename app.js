const STORAGE_URL_KEY = "flashcards_sheet_url";
const STORAGE_GID_KEY = "flashcards_sheet_gid";

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

function setStatus(message) {
  statusLabel.textContent = message;
}

function parseSpreadsheetInfo(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      return null;
    }

    const id = match[1];
    const gid = url.searchParams.get("gid") || "0";
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

async function discoverDeckTabs(spreadsheetId) {
  const urls = [
    `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/basic?alt=json`,
    `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/full?alt=json`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const entries = data?.feed?.entry || [];
      const decks = entries
        .map(entry => {
          const name = entry?.title?.$t || "";
          const idText = entry?.id?.$t || "";
          const match = idText.match(/\/([0-9]+)$/);
          const gid = match ? match[1] : "";
          return { name, gid };
        })
        .filter(item => item.name && item.gid);

      if (decks.length) {
        return decks;
      }
    } catch {
      // Try next discovery endpoint.
    }
  }

  return [];
}

async function loadDeckByGid(spreadsheetId, gid) {
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
  localStorage.setItem(STORAGE_GID_KEY, gid);

  const selectedName = deckSelect.options[deckSelect.selectedIndex]?.text || `gid ${gid}`;
  setStatus(`Loaded ${deck.length} cards from deck: ${selectedName}.`);
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

  localStorage.setItem(STORAGE_URL_KEY, rawUrl);
  currentSpreadsheetId = info.id;

  const discovered = await discoverDeckTabs(currentSpreadsheetId);
  const availableDecks = discovered.length ? discovered : [{ name: "Default (gid 0)", gid: "0" }];

  const preferredSavedGid = localStorage.getItem(STORAGE_GID_KEY) || info.gid || "0";
  const preferredGid = availableDecks.some(item => item.gid === preferredSavedGid)
    ? preferredSavedGid
    : availableDecks[0].gid;

  renderDeckOptions(availableDecks, preferredGid);

  if (!discovered.length) {
    setStatus("Connected, but tab names are unavailable. Using gid-based fallback deck selection.");
  }

  try {
    await loadDeckByGid(currentSpreadsheetId, preferredGid);
  } catch (error) {
    setFallbackDeck(`Could not load selected deck. ${error.message}`);
  }
}

connectBtn.addEventListener("click", connectSheet);

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

(async function init() {
  const savedUrl = localStorage.getItem(STORAGE_URL_KEY) || "";
  sheetUrlInput.value = savedUrl;

  if (savedUrl) {
    await connectSheet();
  } else {
    renderDeckOptions([{ name: "Sample Deck", gid: "fallback" }], "fallback");
    deckSelect.disabled = true;
    setFallbackDeck("Using built-in sample deck.");
  }
})();
