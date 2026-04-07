const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const listEl = document.getElementById("prospect-list");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "";
}

function escapeCSV(value) {
  if (!value) return "";
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function escapeHTML(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeLinkedInProfileUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "in" && parts[1]) {
      return parsed.origin + "/in/" + parts[1] + "/";
    }
    return parsed.origin + parsed.pathname;
  } catch (_err) {
    return rawUrl;
  }
}

function normalizeName(raw) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function deriveNameFromTab(tab) {
  const title = normalizeName(tab?.title || "");
  if (title) {
    const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
    if (cleaned && !/^(LinkedIn|LinkedIn:\s*)$/i.test(cleaned)) return cleaned;
  }

  try {
    const parsed = new URL(tab?.url || "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "in" && parts[1]) {
      const slug = decodeURIComponent(parts[1]).replace(/[-_]+/g, " ").trim();
      return slug
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  } catch (_err) {
    // Ignore URL parsing errors.
  }

  return "";
}

function renderProspects(prospects) {
  countEl.textContent = prospects.length + " profile" + (prospects.length !== 1 ? "s" : "") + " saved";
  if (prospects.length === 0) {
    listEl.innerHTML = "";
    return;
  }
  const recent = prospects.slice(-10).reverse();
  let html = "<table><tr><th>Name</th><th>LinkedIn URL</th></tr>";
  for (const p of recent) {
    const safeName = escapeHTML(p.name || "");
    const safeUrl = escapeHTML(p.linkedinUrl || "");
    const urlCell = safeUrl
      ? "<a href=\"" + safeUrl + "\" target=\"_blank\" rel=\"noreferrer\">Profile</a>"
      : "";
    html += "<tr><td title=\"" + safeName + "\">" + safeName + "</td><td title=\"" + safeUrl + "\">" + urlCell + "</td></tr>";
  }
  html += "</table>";
  if (prospects.length > 10) {
    html += "<div style='font-size:11px;color:#6b7280;margin-top:4px;'>Showing last 10 of " + prospects.length + "</div>";
  }
  listEl.innerHTML = html;
}

function loadProspects() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ prospects: [] }, (data) => {
      resolve(data.prospects);
    });
  });
}

async function init() {
  const prospects = await loadProspects();
  renderProspects(prospects);
}

document.getElementById("scrape-btn").addEventListener("click", async () => {
  setStatus("");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes("linkedin.com/in/")) {
    setStatus("Navigate to a LinkedIn profile page first.", true);
    return;
  }

  const prospects = await loadProspects();
  const linkedinUrl = normalizeLinkedInProfileUrl(tab.url);
  const name = deriveNameFromTab(tab);
  if (!linkedinUrl) {
    setStatus("Could not read profile URL from this page.", true);
    return;
  }

  const existingIndex = prospects.findIndex((p) => (p.linkedinUrl || "") === linkedinUrl);
  if (existingIndex !== -1) {
    if (name && !prospects[existingIndex].name) {
      prospects[existingIndex].name = name;
      chrome.storage.local.set({ prospects }, () => {
        renderProspects(prospects);
        setStatus("Updated saved profile.");
      });
      return;
    }
    setStatus("This profile URL is already saved.", true);
    return;
  }

  prospects.push({ name, linkedinUrl });
  chrome.storage.local.set({ prospects }, () => {
    renderProspects(prospects);
    setStatus("Added profile.");
  });
});

document.getElementById("export-btn").addEventListener("click", async () => {
  const prospects = await loadProspects();
  if (prospects.length === 0) {
    setStatus("No profiles to export.", true);
    return;
  }

  let csv = "Name,LinkedIn URL\n";
  for (const p of prospects) {
    csv += escapeCSV(p.name) + "," + escapeCSV(p.linkedinUrl) + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({ url, filename: "Prospects.csv", saveAs: false }, () => {
    setStatus("Exported Prospects.csv to Downloads.");
    URL.revokeObjectURL(url);
  });
});

document.getElementById("clear-btn").addEventListener("click", () => {
  if (confirm("Clear all saved profiles?")) {
    chrome.storage.local.set({ prospects: [] }, () => {
      renderProspects([]);
      setStatus("All profiles cleared.");
    });
  }
});

init();
