import express from "express";
import fs from "fs";
import natural from "natural";
import { removeStopwords } from "stopword";

const app = express();
const PORT = 3000;

// Serve frontend
app.use(express.static("public"));

// Load problems.json
let problems = [];
try {
  problems = JSON.parse(fs.readFileSync("problems.json", "utf-8"));
} catch {
  console.error("Could not load problems.json. Run scraper.js first!");
  process.exit(1);
}

// Setup TF-IDF using title + description + topics
const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();

problems.forEach((problem, index) => {
  const textFields = [
    problem.title || "",
    problem.description || "",
    (problem.topics || []).join(" ")
  ].join(" ").toLowerCase();

  const tokens = removeStopwords(textFields.split(/\s+/));
  tfidf.addDocument(tokens.join(" "), index);
});

// Utility to shuffle an array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Convert Elo into unified difficulty 1–10
function getDifficultyScore(problem) {
  const elo = problem.elo || 1500; // fallback if missing
  // Map 800–3500 Elo to 1–10 scale
  const score = Math.min(Math.max(Math.round(((elo - 800) / (3500 - 800)) * 10), 1), 10);
  return score;
}

// Search API
app.get("/search", (req, res) => {
  const query = (req.query.query || "").toLowerCase();
  const selectedDifficulties = req.query.difficulties
    ? req.query.difficulties.split(",").map(Number)
    : [];

  if (!query) return res.json([]);

  const tokenizedQuery = removeStopwords(query.split(/\s+/)).join(" ");

  let searchResults = [];
  tfidf.tfidfs(tokenizedQuery, (i, measure) => {
    if (measure > 0) {
      searchResults.push({
        ...problems[i],
        relevance: measure,
      });
    }
  });

  // Filter by difficulty
  const filteredResults = selectedDifficulties.length > 0
    ? searchResults.filter(result => selectedDifficulties.includes(getDifficultyScore(result)))
    : searchResults;

  // Sort by relevance
  filteredResults.sort((a, b) => b.relevance - a.relevance);

  res.json(shuffleArray(filteredResults));

});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
