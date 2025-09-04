# DSA Search Engine

**Description:**
A lightweight search engine for DSA problems from **LeetCode** and **Codeforces**. Search by **title, description, and topics**, and filter by difficulty.

---

## Setup

1. Clone the repo:
```bash
git clone <repo-url>
cd dsa-search-engine
```

2. Install dependencies:
```bash
npm install
```

3. Scrape problems:
```bash
npm run scrape
```

4. Start the server:
```bash
npm start
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## File Structure

- **frontend/** → HTML, CSS, JS for the UI  
- **problems.json** → Scraped problems  
- **scraper.js** → Fetch LeetCode & Codeforces problems  
- **server.js** → Express backend with search API  

---

## Features

- TF-IDF search across **title, description, and topics**  
- Unified difficulty score (1–10)  
- Randomized problem order (mix of LeetCode and Codeforces)  
- Clickable links to original problems  

---

## Notes

- LeetCode problems include **Elo rating** and topics.  
- Codeforces scraping fetches **tags, solved count, and Elo**.  
- Requires **Node.js** and internet access for scraping.

