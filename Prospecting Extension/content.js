// Content script: scrapes LinkedIn profile data from the current page

function scrapeProfile() {
  const name =
    document.querySelector("h1.text-heading-xlarge") ?.innerText ?.trim() ||
    document.querySelector("h1") ?.innerText ?.trim() ||
    "";

  const title =
    document.querySelector("div.text-body-medium.break-words") ?.innerText ?.trim() ||
    "";

  // Company can appear in the experience section or in the top card
  const company =
    document.querySelector(
      "button[aria-label*='Current company'] span"
    ) ?.innerText ?.trim() ||
    document.querySelector(
      "div.inline-show-more-text--is-collapsed span[aria-hidden='true']"
    ) ?.innerText ?.trim() ||
    extractCompanyFromTopCard() ||
    "";

  return { name, title, company };
}

function extractCompanyFromTopCard() {
  // Fallback: look for a link to a company page in the top introduction section
  const topCard = document.querySelector("section.artdeco-card");
  if (!topCard) return "";
  const companyLink = topCard.querySelector('a[href*="/company/"]');
  if (companyLink) {
    return companyLink.innerText.trim();
  }
  return "";
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "scrape") {
    const data = scrapeProfile();
    sendResponse(data);
  }
});
