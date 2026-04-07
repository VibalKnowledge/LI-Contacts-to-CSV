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

function renderProspects(prospects) {
  countEl.textContent = prospects.length + " prospect" + (prospects.length !== 1 ? "s" : "") + " saved";
  if (prospects.length === 0) {
    listEl.innerHTML = "";
    return;
  }
  const recent = prospects.slice(-10).reverse();
  let html = "<table><tr><th>Name</th><th>Title</th><th>Company</th></tr>";
  for (const p of recent) {
    html += "<tr><td title=\"" + (p.name || "") + "\">" + (p.name || "") + "</td>"
          + "<td title=\"" + (p.title || "") + "\">" + (p.title || "") + "</td>"
          + "<td title=\"" + (p.company || "") + "\">" + (p.company || "") + "</td></tr>";
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

// Add current profile
document.getElementById("scrape-btn").addEventListener("click", async () => {
  setStatus("");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes("linkedin.com/in/")) {
    setStatus("Navigate to a LinkedIn profile page first.", true);
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: "scrape" }, async (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Could not scrape page. Try refreshing the LinkedIn tab.", true);
      return;
    }

    if (!response || !response.name) {
      setStatus("Could not find profile data on this page.", true);
      return;
    }

    const prospects = await loadProspects();

    // Check for duplicates by name
    const exists = prospects.some(
      (p) => p.name.toLowerCase() === response.name.toLowerCase()
    );
    if (exists) {
      setStatus("This prospect is already saved.", true);
      return;
    }

    prospects.push({
      name: response.name,
      title: response.title,
      company: response.company,
    });

    chrome.storage.local.set({ prospects }, () => {
      renderProspects(prospects);
      setStatus("Added: " + response.name);
    });
  });
});

// Export CSV
document.getElementById("export-btn").addEventListener("click", async () => {
  const prospects = await loadProspects();
  if (prospects.length === 0) {
    setStatus("No prospects to export.", true);
    return;
  }

  let csv = "Name,Title,Company\n";
  for (const p of prospects) {
    csv += escapeCSV(p.name) + "," + escapeCSV(p.title) + "," + escapeCSV(p.company) + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download(
    { url, filename: "Prospects.csv", saveAs: false },
    () => {
      setStatus("Exported Prospects.csv to Downloads.");
      URL.revokeObjectURL(url);
    }
  );
});

// Clear all
document.getElementById("clear-btn").addEventListener("click", () => {
  if (confirm("Clear all saved prospects?")) {
    chrome.storage.local.set({ prospects: [] }, () => {
      renderProspects([]);
      setStatus("All prospects cleared.");
    });
  }
});

init();
