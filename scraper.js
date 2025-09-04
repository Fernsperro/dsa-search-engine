// scraper.js
import puppeteer from "puppeteer";
import fs from "fs/promises";

/*
  Configuration
*/
const OUTPUT_FILE = "problems.json";
const LIMIT_PER_PLATFORM = 500;
const CONCURRENCY_LIMIT = 10;

// Set HEADLESS env var to "true" to force headless mode; default is visible (safer for Codeforces)
const HEADLESS = "true";

const LEETCODE_ALL_PROBLEMS_URL = "https://leetcode.com/api/problems/all/";
const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";
const CODEFORCES_PROBLEMSET_URL = "https://codeforces.com/problemset";

/*
  Utilities
*/
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function loadProblems() {
  try {
    const data = await fs.readFile(OUTPUT_FILE, "utf-8");
    if (!data.trim()) {
      console.warn(`${OUTPUT_FILE} is empty. Starting fresh.`);
      return [];
    }
    try {
      return JSON.parse(data);
    } catch (parseErr) {
      console.warn(`${OUTPUT_FILE} is corrupted. Creating a fresh list and backing up the old file.`);
      try {
        await fs.rename(OUTPUT_FILE, `${OUTPUT_FILE}.bak`);
        console.log(`Backed up corrupted file to ${OUTPUT_FILE}.bak`);
      } catch (e) {
        // ignore backup errors
      }
      return [];
    }
  } catch (err) {
    if (err.code === "ENOENT") return []; // file doesn't exist yet
    throw err;
  }
}

async function saveProblems(problems) {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(problems, null, 2));
  console.log(`Saved ${problems.length} problems to ${OUTPUT_FILE}`);
}

/*
  Elo mapping utilities
*/
function leetAcceptanceToElo(acceptancePct) {
  // Map acceptance (0..100) to Elo roughly in 800..3500 (higher acceptance -> easier -> lower Elo)
  if (typeof acceptancePct !== "number" || Number.isNaN(acceptancePct)) return 2000;
  const rate = Math.max(0, Math.min(100, acceptancePct)) / 100; // 0..1
  return Math.round(800 + (1 - rate) * 2700);
}

function solvedCountToElo(solvedCount) {
  // Rough mapping by popularity (lower solvedCount => harder => higher Elo)
  if (!solvedCount || Number.isNaN(solvedCount)) return 1500;
  if (solvedCount > 20000) return 1200;
  if (solvedCount > 10000) return 1400;
  if (solvedCount > 5000) return 1600;
  if (solvedCount > 1000) return 2000;
  return 2300;
}

/*
  LeetCode: Fetch list (REST) then details (GraphQL)
*/
async function fetchLeetCodeDetails(problems) {
  const detailed = await Promise.all(
    problems.map(async (prob) => {
      try {
        const gqlRes = await fetch(LEETCODE_GRAPHQL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              query getProblem($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                  content
                  stats
                  topicTags { name }
                }
              }
            `,
            variables: { titleSlug: prob.slug },
          }),
        });

        if (!gqlRes.ok) {
          throw new Error(`HTTP ${gqlRes.status}`);
        }

        const gqlData = await gqlRes.json();
        const q = gqlData?.data?.question;

        let acceptanceRate = null;
        try {
          const stats = q?.stats ? JSON.parse(q.stats) : {};
          if (stats.acRate) {
            acceptanceRate = parseFloat(String(stats.acRate).replace("%", ""));
          } else if (stats.totalSubmission > 0 || stats.totalSubmitted > 0) {
            // handle both possible field names
            const totalAccepted = stats.totalAccepted || stats.total_ac || 0;
            const totalSubmission = stats.totalSubmission || stats.totalSubmitted || 0;
            if (totalSubmission > 0) {
              acceptanceRate = (totalAccepted / totalSubmission) * 100;
            }
          }
        } catch {
          // ignore parse errors; acceptanceRate remains null
        }

        return {
          ...prob,
          description: q?.content ? stripHTML(q.content) : "N/A",
          topics: q?.topicTags?.map((t) => t.name) || [],
          acceptanceRate,
          elo: leetAcceptanceToElo(acceptanceRate),
        };
      } catch (err) {
        console.error(`LeetCode detail fetch failed for ${prob.slug}: ${err.message}`);
        return null;
      }
    })
  );

  return detailed.filter(Boolean);
}

async function fetchLeetCodeProblems() {
  console.log("Fetching LeetCode problems list...");
  const res = await fetch(LEETCODE_ALL_PROBLEMS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch LeetCode list: ${res.statusText}`);
  }
  const data = await res.json();

  const problems = data.stat_status_pairs.map((p) => ({
    source: "LeetCode",
    id: p.stat.question_id,
    title: p.stat.question__title,
    slug: p.stat.question__title_slug,
    difficulty: ["Easy", "Medium", "Hard"][p.difficulty.level - 1],
    url: `https://leetcode.com/problems/${p.stat.question__title_slug}/`,
  }));

  const limited = problems.slice(0, LIMIT_PER_PLATFORM);
  let allDetailed = [];

  for (let i = 0; i < limited.length; i += CONCURRENCY_LIMIT) {
    const chunk = limited.slice(i, i + CONCURRENCY_LIMIT);
    console.log(`LeetCode: fetching details ${i + 1}..${i + chunk.length}`);
    const detailedChunk = await fetchLeetCodeDetails(chunk);
    allDetailed.push(...detailedChunk);
  }

  console.log(`Collected ${allDetailed.length} LeetCode problems (detailed)`);
  return allDetailed;
}

/*
  Codeforces: parse problemset table (robustly, with headless fallback)
*/
async function scrapeCodeforces(limit = LIMIT_PER_PLATFORM) {
  async function run(headlessFlag) {
    console.log(`Scraping Codeforces (headless=${headlessFlag})`);
    const browser = await puppeteer.launch({
      headless: headlessFlag,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: 1200, height: 900 },
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

    const problems = [];
    try {
      let pageNum = 1;
      while (problems.length < limit) {
        const url = `${CODEFORCES_PROBLEMSET_URL}/page/${pageNum}`;
        console.log(`Visiting Codeforces page ${pageNum}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

        try {
          await page.waitForSelector("table.problems", { timeout: 5000 });
        } catch {
          console.warn("table.problems not found on the page; capturing HTML snapshot");
          const html = await page.content();
          console.log("Snapshot (first 500 chars):\n", html.slice(0, 500));
          break;
        }

        const rowsData = await page.$$eval("table.problems tr", (trs) =>
          trs.slice(1).map((tr) => {
            const idNode = tr.querySelector("td.id a");
            const titleNode = tr.querySelector("td:nth-child(2) div:first-child a");
            const tagNodes = Array.from(tr.querySelectorAll("td:nth-child(2) div:last-child a"));
            const solvedAnchor = tr.querySelector("td:last-child a");

            if (!idNode || !titleNode) return null;

            const id = idNode.textContent.trim();
            const title = titleNode.textContent.trim();
            const tags = tagNodes.map((a) => a.textContent.trim());
            const solvedText = solvedAnchor ? solvedAnchor.textContent.trim() : null;
            const solvedMatch = solvedText ? solvedText.match(/x\s*([\d,]+)/i) : null;
            const solvedCount = solvedMatch ? parseInt(solvedMatch[1].replace(/,/g, ""), 10) : null;

            let url = "";
            const m = id.match(/^(\d+)([A-Z]\d*)$/i);
            if (m) url = `https://codeforces.com/problemset/problem/${m[1]}/${m[2]}`;

            return { id, title, url, tags, solvedCount };
          })
        );

        const valid = rowsData.filter(Boolean);
        if (valid.length === 0) {
          console.log("No problem rows found on this page; stopping.");
          break;
        }

        problems.push(...valid);
        pageNum++;
      }
    } catch (err) {
      console.error("Codeforces scraping error:", err.message);
    } finally {
      await browser.close();
    }

    console.log(`Collected ${problems.length} problems from Codeforces (headless=${headlessFlag})`);
    return problems.slice(0, limit);
  }

  const primary = await run(HEADLESS);
  if (primary.length > 0) return primary;

  if (HEADLESS) {
    console.log("Headless run returned 0 problems; retrying in visible mode");
    const fallback = await run(false);
    return fallback;
  }

  return primary;
}

/*
  Main execution
*/
(async () => {
  try {
    const existingProblems = await loadProblems();
    console.log(`Found ${existingProblems.length} existing problems.`);

    const needLeet = !existingProblems.some((p) => p.source === "LeetCode");
    const needCF = !existingProblems.some((p) => p.source === "Codeforces");

    const newCollected = [];

    if (needLeet) {
      const leet = await fetchLeetCodeProblems();
      newCollected.push(...leet);
    } else {
      console.log("LeetCode already present; skipping LeetCode fetch.");
    }

    if (needCF) {
      const cf = await scrapeCodeforces(LIMIT_PER_PLATFORM);
      const cfNormalized = cf.map((c) => ({
        source: "Codeforces",
        id: c.id,
        title: c.title,
        url: c.url || "https://codeforces.com/problemset",
        description: "N/A",
        topics: c.tags || [],
        solvedCount: c.solvedCount || null,
        elo: solvedCountToElo(c.solvedCount || null),
      }));
      newCollected.push(...cfNormalized);
    } else {
      console.log("Codeforces already present; skipping Codeforces fetch.");
    }

    const allProblems = [...existingProblems];
    const seen = new Set(existingProblems.map((p) => p.url));

    for (const p of newCollected) {
      if (p && p.url && !seen.has(p.url)) {
        allProblems.push(p);
        seen.add(p.url);
      }
    }

    await saveProblems(allProblems);

    const counts = allProblems.reduce((acc, cur) => {
      acc[cur.source] = (acc[cur.source] || 0) + 1;
      return acc;
    }, {});

    console.log("Summary:", counts);
    console.log("Scraping finished. Problems file is ready for downstream processing.");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
})();
