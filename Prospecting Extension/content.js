// Content script: scrapes LinkedIn profile data from the current page

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function textFromSelector(selector) {
  const el = document.querySelector(selector);
  return cleanText(el?.innerText || el?.textContent || "");
}

function firstNonEmpty(values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function textFromButtonAriaLabel(labelPart) {
  const button = document.querySelector(`button[aria-label*="${labelPart}"]`);
  if (!button) return "";
  const text = cleanText(button.innerText || button.textContent || "");
  return cleanText(text.replace(/^Current (company|position)\s*[:\-]\s*/i, ""));
}

function extractNameFromMeta() {
  const ogTitle = cleanText(
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")
  );
  if (!ogTitle) return "";
  return cleanText(ogTitle.replace(/\s*\|\s*LinkedIn.*$/i, ""));
}

function extractProfileFromLdJson() {
  const result = { name: "", title: "", company: "" };
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const raw = script.textContent;
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed?.["@graph"] && Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const item of items) {
        const type = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        if (!type.includes("Person")) continue;

        if (!result.name && cleanText(item?.name)) {
          result.name = cleanText(item.name);
        }
        if (!result.title && cleanText(item?.jobTitle)) {
          result.title = cleanText(item.jobTitle);
        }
        if (!result.company) {
          const worksFor = item?.worksFor;
          if (Array.isArray(worksFor)) {
            const org = worksFor.find((w) => cleanText(w?.name));
            if (org) result.company = cleanText(org.name);
          } else if (worksFor && cleanText(worksFor?.name)) {
            result.company = cleanText(worksFor.name);
          }
        }
      }
    } catch (_err) {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return result;
}

function extractCompanyFromTopCard() {
  const topCard =
    document.querySelector("main section.artdeco-card") ||
    document.querySelector(".pv-top-card") ||
    document.querySelector("section.artdeco-card");
  if (!topCard) return "";
  const companyLink = topCard.querySelector('a[href*="/company/"]');
  return cleanText(companyLink?.innerText || companyLink?.textContent || "");
}

function extractTitleFromDocumentTitle(name) {
  const rawTitle = cleanText(document.title).replace(/\s*\|\s*LinkedIn.*$/i, "");
  if (!rawTitle) return "";
  if (name) {
    const prefix = name + " - ";
    if (rawTitle.startsWith(prefix)) return cleanText(rawTitle.slice(prefix.length));
  }
  const parts = rawTitle.split(" - ").map(cleanText).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return "";
}

function deriveCompanyFromTitle(title) {
  if (!title) return "";
  const match = title.match(/\bat\s+(.+)$/i);
  return cleanText(match?.[1] || "");
}

function getTopCardContainer() {
  return (
    document.querySelector("main section.artdeco-card") ||
    document.querySelector(".pv-top-card") ||
    document.querySelector(".top-card-layout") ||
    document.querySelector("section.artdeco-card")
  );
}

function extractTitleFromTopCardText(name) {
  const topCard = getTopCardContainer();
  if (!topCard) return "";

  // Prefer known headline selectors from modern/legacy profile layouts.
  const direct = firstNonEmpty([
    textFromSelector(".top-card-layout__headline"),
    textFromSelector(".pv-text-details__left-panel .text-body-medium"),
    textFromSelector(".ph5 .text-body-medium.break-words"),
    textFromSelector(".ph5 .text-body-medium")
  ]);
  if (direct) return direct;

  const lines = cleanText(topCard.innerText || topCard.textContent || "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);

  const ignorePatterns = [
    /^contact info$/i,
    /^message$/i,
    /^follow$/i,
    /^more$/i,
    /followers?/i,
    /connections?/i
  ];

  for (const line of lines) {
    if (name && line.toLowerCase() === name.toLowerCase()) continue;
    if (line.length < 8 || line.length > 320) continue;
    if (ignorePatterns.some((pattern) => pattern.test(line))) continue;
    // A headline usually contains role-like words or "at Company".
    if (/\bat\b/i.test(line) || /manager|director|founder|engineer|consultant|lead|head|owner|president|ceo|cto|coo|cfo|specialist|developer|designer/i.test(line)) {
      return line;
    }
  }

  return "";
}

function extractCompanyFromTopCardLinks() {
  const topCard = getTopCardContainer();
  if (!topCard) return "";
  const companyLink = topCard.querySelector('a[href*="/company/"]');
  return cleanText(companyLink?.innerText || companyLink?.textContent || "");
}

function extractCurrentCompanyFromExperienceSection() {
  const headings = Array.from(document.querySelectorAll("main h2, main h3, main span, main div"));
  const experienceHeading = headings.find(
    (el) => cleanText(el.textContent).toLowerCase() === "experience"
  );
  if (!experienceHeading) return "";

  const section = experienceHeading.closest("section") || experienceHeading.parentElement;
  if (!section) return "";

  const companyLink = section.querySelector('a[href*="/company/"]');
  const companyFromLink = cleanText(companyLink?.innerText || companyLink?.textContent || "");
  if (companyFromLink) return companyFromLink;

  const lines = cleanText(section.innerText || section.textContent || "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !/^experience$/i.test(line))
    .filter((line) => !/show all|show more|show less/i.test(line));

  // Common pattern: [role, company, dates, ...]
  if (lines.length >= 2) return lines[1];
  return "";
}

function isUiNoiseLine(line) {
  return (
    /^experience$/i.test(line) ||
    /^show all/i.test(line) ||
    /^show more/i.test(line) ||
    /^show less/i.test(line) ||
    /^see all/i.test(line) ||
    /^follow$/i.test(line) ||
    /^message$/i.test(line)
  );
}

function isLikelyDateLine(line) {
  return /\b(present|\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(line);
}

function isLikelyRoleDateLine(line) {
  return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\s+\d{4}\b/i.test(line);
}

function isLikelyLocationLine(line) {
  return /,\s|united states|remote|bay area|area$/i.test(line);
}

function isLikelyEmploymentTypeLine(line) {
  return /\b(full-time|part-time|contract|internship|self-employed|freelance|temporary)\b/i.test(line);
}

function isLikelyTenureLine(line) {
  return /^\d+\s+(yrs?|years?)\b.*$/i.test(line) || /^\d+\s+mos?\b.*$/i.test(line);
}

function isLikelyRoleLine(line) {
  return /\b(vice president|vp|director|manager|lead|head|founder|co-founder|owner|ceo|cto|coo|cfo|president|engineer|developer|designer|analyst|consultant|specialist|marketing|sales|product|operations)\b/i.test(line);
}

function isLikelyDescriptionLine(line) {
  return /[.!?]/.test(line) || line.split(" ").length > 12;
}

function normalizeCompanyText(line) {
  let value = cleanText(line);
  value = value.replace(/^(full-time|part-time|contract|internship|self-employed|freelance|temporary)\b.*$/i, "");
  value = value.replace(/\s*·\s*(full-time|part-time|contract|internship|self-employed|freelance|temporary).*/i, "");
  value = value.replace(/\s+\d+\s+years?.*$/i, "");
  value = value.replace(/\s+\d+\s+mos?.*$/i, "");
  value = value.replace(/[·-]\s*$/g, "");
  return cleanText(value);
}

function getExperienceSection() {
  const sections = Array.from(document.querySelectorAll("main section"));
  return (
    sections.find((section) => {
      const heading = cleanText(section.querySelector("h2, h3, span")?.textContent || "");
      if (/^experience$/i.test(heading)) return true;
      return /\nexperience\n/i.test("\n" + cleanText(section.innerText || section.textContent || "") + "\n");
    }) || null
  );
}

function extractTopExperienceFromLines(rawLines, sectionForCompanyLink = null) {
  const headingIdx = rawLines.findIndex((line) => /^experience$/i.test(line));
  const candidates = rawLines
    .slice(headingIdx === -1 ? 0 : headingIdx + 1)
    .filter((line) => !isUiNoiseLine(line));

  // Anchor on the first explicit month/year role date in Experience.
  const firstDateIdx = candidates.findIndex((line) => isLikelyRoleDateLine(line));
  if (firstDateIdx <= 0) return { title: "", company: "" };

  let title = cleanText(candidates[firstDateIdx - 1] || "");
  if (
    !title ||
    isLikelyDateLine(title) ||
    isLikelyLocationLine(title) ||
    isLikelyEmploymentTypeLine(title) ||
    isLikelyTenureLine(title) ||
    isLikelyDescriptionLine(title)
  ) {
    let bestRoleLike = "";
    for (let i = firstDateIdx - 1; i >= Math.max(0, firstDateIdx - 5); i -= 1) {
      const candidate = cleanText(candidates[i] || "");
      if (!candidate) continue;
      if (isLikelyDateLine(candidate) || isLikelyLocationLine(candidate) || isLikelyEmploymentTypeLine(candidate)) continue;
      if (isLikelyTenureLine(candidate)) continue;
      if (isLikelyDescriptionLine(candidate) || isUiNoiseLine(candidate)) continue;
      if (isLikelyRoleLine(candidate)) {
        title = candidate;
        break;
      }
      if (!bestRoleLike) bestRoleLike = candidate;
    }
    if (!title && bestRoleLike) title = bestRoleLike;
  }

  if (!title || isLikelyDateLine(title) || isLikelyLocationLine(title) || isLikelyEmploymentTypeLine(title) || isLikelyTenureLine(title)) {
    return { title: "", company: "" };
  }

  let company = "";

  // First try lines between title and date (title-first layouts: "Title", "Company · Full-time", "Date").
  for (let i = firstDateIdx - 1; i >= 0; i -= 1) {
    const raw = cleanText(candidates[i] || "");
    if (!raw || raw.toLowerCase() === title.toLowerCase()) continue;
    if (isUiNoiseLine(raw) || isLikelyDateLine(raw) || isLikelyLocationLine(raw) || isLikelyDescriptionLine(raw)) continue;
    if (isLikelyTenureLine(raw)) continue;
    const normalized = normalizeCompanyText(raw);
    if (!normalized) continue;
    if (normalized.toLowerCase() === title.toLowerCase()) continue;
    if (isLikelyEmploymentTypeLine(normalized)) continue;
    if (isLikelyTenureLine(normalized)) continue;
    company = normalized;
    break;
  }

  // If still empty, try the first explicit company link in Experience.
  if (!company && sectionForCompanyLink) {
    const companyLink = sectionForCompanyLink.querySelector('a[href*="/company/"]');
    company = normalizeCompanyText(cleanText(companyLink?.innerText || companyLink?.textContent || ""));
  }

  return { title: cleanText(title), company: cleanText(company) };
}

function getBodyExperienceLines() {
  const lines = (document.body?.innerText || "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 400);

  const startIdx = lines.findIndex((line) => /^experience$/i.test(line));
  if (startIdx === -1) return [];

  const sectionStopPattern = /^(education|skills|projects|certifications|honors|awards|publications|volunteer experience|volunteering|courses|recommendations|interests|languages)$/i;
  const out = ["Experience"];

  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (sectionStopPattern.test(line)) break;
    out.push(line);
    if (out.length >= 160) break;
  }

  return out;
}

function extractTopExperience() {
  const section = getExperienceSection();
  const sectionLines = section
    ? (section.innerText || section.textContent || "")
        .split(/\n+/)
        .map(cleanText)
        .filter(Boolean)
    : [];

  const fromSection = extractTopExperienceFromLines(sectionLines, section);
  if (fromSection.title && fromSection.company) return fromSection;

  const fromBody = extractTopExperienceFromLines(getBodyExperienceLines(), null);
  return {
    title: fromSection.title || fromBody.title || "",
    company: fromSection.company || fromBody.company || ""
  };
}

function getExperienceLines() {
  const section = getExperienceSection();
  const lines = section
    ? (section.innerText || section.textContent || "")
        .split(/\n+/)
        .map(cleanText)
        .filter(Boolean)
    : getBodyExperienceLines();

  return lines.slice(0, 120);
}

function extractTopExperienceRawText() {
  const lines = getExperienceLines();
  if (lines.length === 0) return "";

  const headingIdx = lines.findIndex((line) => /^experience$/i.test(line));
  const candidates = lines
    .slice(headingIdx === -1 ? 0 : headingIdx + 1)
    .filter((line) => !isUiNoiseLine(line));

  const firstDateIdx = candidates.findIndex((line) => isLikelyRoleDateLine(line));
  if (firstDateIdx === -1) {
    return candidates.slice(0, 20).join("\n");
  }

  let nextDateIdx = -1;
  for (let i = firstDateIdx + 1; i < candidates.length; i += 1) {
    if (isLikelyRoleDateLine(candidates[i])) {
      nextDateIdx = i;
      break;
    }
  }

  const start = Math.max(0, firstDateIdx - 3);
  const end = nextDateIdx !== -1 ? nextDateIdx : Math.min(candidates.length, firstDateIdx + 10);
  return candidates.slice(start, end).join("\n");
}

function extractExperienceContextFromPage() {
  const full = cleanText(document.body?.innerText || "");
  if (!full) return "";

  const lower = full.toLowerCase();
  const startMarker = "experience";
  const startIdx = lower.indexOf(startMarker);
  if (startIdx === -1) return full.slice(0, 8000);

  const tail = full.slice(startIdx);
  const stopRegex = /\b(education|skills|projects|certifications|honors|awards|publications|volunteer experience|interests|languages)\b/i;
  const stopMatch = tail.match(stopRegex);
  const endIdx = stopMatch ? stopMatch.index : Math.min(tail.length, 8000);
  return tail.slice(0, endIdx).slice(0, 8000);
}

function scrapeProfile() {
  const ldProfile = extractProfileFromLdJson();
  const topExperience = extractTopExperience();
  const experienceRaw = extractTopExperienceRawText();
  const experienceContext = extractExperienceContextFromPage();

  const name = firstNonEmpty([
    textFromSelector("main h1"),
    textFromSelector("h1.text-heading-xlarge"),
    textFromSelector("h1"),
    extractNameFromMeta(),
    ldProfile.name,
    cleanText(document.title).replace(/\s*\|\s*LinkedIn.*$/i, "")
  ]);

  const title = firstNonEmpty([
    topExperience.title,
    textFromButtonAriaLabel("Current position"),
    textFromSelector("main .text-body-medium.break-words"),
    textFromSelector("main .text-body-medium"),
    textFromSelector(".pv-text-details__left-panel .text-body-medium"),
    textFromSelector("main .pv-text-details__left-panel div.text-body-medium"),
    extractTitleFromTopCardText(name),
    ldProfile.title,
    extractTitleFromDocumentTitle(name)
  ]);

  const company = firstNonEmpty([
    topExperience.company,
    textFromButtonAriaLabel("Current company"),
    textFromSelector(".top-card-layout__first-subline a[href*='/company/']"),
    textFromSelector("button[aria-label*='Current company'] span[aria-hidden='true']"),
    textFromSelector("button[aria-label*='Current company'] span"),
    textFromSelector(".pv-text-details__right-panel a[href*='/company/']"),
    extractCompanyFromTopCardLinks(),
    extractCompanyFromTopCard(),
    extractCurrentCompanyFromExperienceSection(),
    ldProfile.company,
    deriveCompanyFromTitle(title)
  ]);

  return { name, title, company, experienceRaw, experienceContext };
}

async function scrapeProfileWithRetry() {
  const maxAttempts = 12;
  const delayMs = 350;
  let best = { name: "", title: "", company: "", experienceRaw: "", experienceContext: "" };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const step = Math.max(500, Math.floor(window.innerHeight * 0.9));
    if (attempt >= 2) window.scrollTo({ top: attempt * step, behavior: "auto" });

    const data = scrapeProfile();
    best = {
      name: best.name || data.name,
      title: best.title || data.title,
      company: best.company || data.company,
      experienceRaw: best.experienceRaw || data.experienceRaw,
      experienceContext: best.experienceContext || data.experienceContext
    };

    // LinkedIn often renders name first, then title/company a moment later.
    if (best.name && (best.title || best.company)) return best;

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const finalData = scrapeProfile();
  return {
    name: best.name || finalData.name,
    title: best.title || finalData.title,
    company: best.company || finalData.company,
    experienceRaw: best.experienceRaw || finalData.experienceRaw,
    experienceContext: best.experienceContext || finalData.experienceContext
  };
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== "scrape") return;
  scrapeProfileWithRetry().then(sendResponse);
  return true;
});
