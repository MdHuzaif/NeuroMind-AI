import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const server = new McpServer({
  name: "neuro-mcp-agent",
  version: "4.0.0",
});

// ============================================================
// HELPER: Fetch from arXiv
// ============================================================
async function fetchArxiv(query: string, maxResults = 10) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}&sortBy=relevance`;
  const res = await fetch(url);
  const text = await res.text();
  const titles = [...text.matchAll(/<title>(.*?)<\/title>/gs)].slice(1).map(m => m[1].trim());
  const abstracts = [...text.matchAll(/<summary>(.*?)<\/summary>/gs)].map(m => m[1].trim());
  const links = [...text.matchAll(/<id>(.*?)<\/id>/gs)].slice(1).map(m => m[1].trim());
  const years = [...text.matchAll(/<published>(.*?)<\/published>/gs)].map(m => m[1].trim().slice(0, 4));
  return titles.map((title, i) => ({
    title,
    abstract: abstracts[i] || "",
    link: links[i] || "",
    year: years[i] || "N/A",
    source: "arXiv",
    citations: 0,
  }));
}

// ============================================================
// HELPER: Fetch from Semantic Scholar
// ============================================================
async function fetchSemanticScholar(query: string, maxResults = 10) {
  try {
    await new Promise(r => setTimeout(r, 1000)); // Rate limit protection
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,abstract,citationCount,year,authors,externalIds`;
    const res = await fetch(url, { headers: { "User-Agent": "NeuroMindAI/4.0" } });
    const data = await res.json() as { data: Array<{ title: string; abstract: string; citationCount: number; year: number; authors: Array<{name: string}>; externalIds: { ArXiv?: string } }> };
    return (data.data || []).map(p => ({
      title: p.title || "N/A",
      abstract: p.abstract || "",
      link: p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : "",
      year: String(p.year || "N/A"),
      source: "Semantic Scholar",
      citations: p.citationCount || 0,
      authors: p.authors?.slice(0, 3).map(a => a.name).join(", ") || "N/A",
    }));
  } catch {
    return [];
  }
}

// ============================================================
// TOOL 1: Deep Research Gap Finder (MAIN TOOL)
// ============================================================
server.registerTool(
  "find_research_gap",
  {
    title: "🔬 Find Research Gap (Advanced)",
    description: "Dual search arXiv + Semantic Scholar, analyze 10 papers, find gaps with novelty scoring, Bangladesh/South Asia context, and comparative table",
    inputSchema: {
      topic: z.string().describe("Research topic, e.g. 'EEG deep learning seizure detection'"),
    },
  },
  async ({ topic }) => {
    // Step 1: Dual Search
    const [arxivPapers, s2Papers] = await Promise.all([
      fetchArxiv(topic, 8),
      fetchSemanticScholar(topic, 8),
    ]);

    // Step 2: Merge and deduplicate
    const allPapers = [...arxivPapers, ...s2Papers];
    const seen = new Set<string>();
    const unique = allPapers.filter(p => {
      const key = p.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Step 3: Sort by citations, take top 10
    const top10 = unique
      .sort((a, b) => b.citations - a.citations)
      .slice(0, 10);

    // Step 4: Build paper summary for Groq (full abstracts, top 5 only for token limit)
    const top5 = top10.slice(0, 5);
    const papersText = top5.map((p, i) =>
      `Paper ${i+1}: ${p.title} (${p.year}) [Citations: ${p.citations}]\nAbstract: ${p.abstract}`
    ).join("\n\n---\n\n");

    // Step 5: Trend analysis
    const yearCounts: Record<string, number> = {};
    top10.forEach(p => {
      yearCounts[p.year] = (yearCounts[p.year] || 0) + 1;
    });
    const trendText = Object.entries(yearCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, count]) => `${year}: ${"█".repeat(count)} (${count})`)
      .join("\n");

    // Step 6: Groq Analysis
    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are a world-class neuroscience researcher and academic advisor. 
Your goal is to provide deep, actionable research gap analysis that can lead to publications and scholarships.
Always be specific, cite paper numbers when relevant, and think about real-world impact.`,
        },
        {
          role: "user",
          content: `Analyze these top papers on "${topic}" and provide a comprehensive research gap report:

${papersText}

Provide the following structured analysis:

## 1. 📊 COMPARATIVE TABLE
Create a markdown table with columns: | Paper | Year | Method | Dataset | Population | XAI | Privacy | Key Limitation |

## 2. 🔍 CURRENT STATE OF RESEARCH
2-3 sentences summarizing what has been done.

## 3. ❌ RESEARCH GAPS (with Novelty Scores)
List 5-7 gaps. For each gap:
- **Gap Name**: Description
- **Novelty Score**: X/10 (10 = completely unexplored)
- **Why Important**: 1 sentence

## 4. 🌍 GEOGRAPHIC & POPULATION GAPS
Check if South Asian, Bangladeshi, African, or Latin American populations are represented. 
If not, explicitly state: "CRITICAL GAP: No studies include [population]"

## 5. 📈 TREND ANALYSIS
Based on years, is this field growing or declining? What does this mean for a researcher entering now?

## 6. 🏆 TOP 3 RECOMMENDED PAPERS TO READ FIRST
With reasons why.

## 7. 💡 MOST PROMISING RESEARCH OPPORTUNITY
One specific, actionable research idea with suggested title and methodology.

## 8. 📝 SUGGESTED PAPER TITLE
A compelling title for a new paper addressing the biggest gap.`,
        },
      ],
      max_tokens: 2000,
    });

    const analysis = aiResponse.choices[0]?.message?.content || "Analysis failed";

    // Step 7: Build final output
    let output = `# 🧠 NeuroMind AI - Research Gap Analysis
## Topic: "${topic}"
## Papers Analyzed: ${top10.length} (arXiv + Semantic Scholar)

---

## 📚 PAPERS FOUND:
${top10.map((p, i) => `${i+1}. **${p.title}** (${p.year}) | Citations: ${p.citations} | Source: ${p.source}\n   🔗 ${p.link || "N/A"}`).join("\n")}

---

## 📈 PUBLICATION TREND:
${trendText}

---

${analysis}`;

    return { content: [{ type: "text", text: output }] };
  }
);

// ============================================================
// TOOL 2: Search Papers (arXiv + Semantic Scholar)
// ============================================================
server.registerTool(
  "search_papers",
  {
    title: "Search Papers (Dual Source)",
    description: "Search neuroscience papers from arXiv AND Semantic Scholar with citation counts",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => {
    const [arxiv, s2] = await Promise.all([
      fetchArxiv(query, 5),
      fetchSemanticScholar(query, 5),
    ]);

    const all = [...arxiv, ...s2].sort((a, b) => b.citations - a.citations);
    let result = `# 🔍 Search Results: "${query}"\n\n`;
    all.forEach((p, i) => {
      result += `## ${i+1}. ${p.title}\n`;
      result += `📅 Year: ${p.year} | 📊 Citations: ${p.citations} | 📰 Source: ${p.source}\n`;
      result += `🔗 ${p.link || "N/A"}\n`;
      result += `📝 ${p.abstract.slice(0, 300)}...\n\n`;
    });

    return { content: [{ type: "text", text: result }] };
  }
);

// ============================================================
// TOOL 3: Search PubMed
// ============================================================
server.registerTool(
  "search_pubmed",
  {
    title: "Search PubMed",
    description: "Search biomedical papers from PubMed",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => {
    try {
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json() as { esearchresult: { idlist: string[] } };
      const ids = searchData.esearchresult.idlist;

      if (ids.length === 0) return { content: [{ type: "text", text: `No PubMed results for: "${query}"` }] };

      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
      const fetchRes = await fetch(fetchUrl);
      const fetchData = await fetchRes.json() as { result: Record<string, { title?: string; authors?: Array<{name: string}>; pubdate?: string; fulljournalname?: string }> };

      let result = `# 🔬 PubMed Results: "${query}"\n\n`;
      ids.forEach((id, i) => {
        const p = fetchData.result[id];
        if (p) {
          result += `${i+1}. **${p.title}**\n`;
          result += `👥 ${p.authors?.slice(0, 3).map(a => a.name).join(", ")}\n`;
          result += `📅 ${p.pubdate} | 📰 ${p.fulljournalname}\n`;
          result += `🔗 https://pubmed.ncbi.nlm.nih.gov/${id}/\n\n`;
        }
      });

      return { content: [{ type: "text", text: result }] };
    } catch {
      return { content: [{ type: "text", text: "PubMed search failed." }] };
    }
  }
);

// ============================================================
// TOOL 4: AI Summarize Paper
// ============================================================
server.registerTool(
  "ai_summarize_paper",
  {
    title: "AI Summarize Paper",
    description: "Deep AI analysis of a paper using full abstract",
    inputSchema: {
      arxiv_id: z.string().describe("arXiv paper ID"),
    },
  },
  async ({ arxiv_id }) => {
    const url = `https://export.arxiv.org/api/query?id_list=${arxiv_id}`;
    const res = await fetch(url);
    const text = await res.text();

    const title = text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found";
    const abstract = text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found";
    const authors = [...text.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1].trim()).join(", ");

    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher." },
        {
          role: "user",
          content: `Analyze this paper completely:
Title: ${title}
Authors: ${authors}
Abstract: ${abstract}

Provide:
1. 🎯 Main Contribution
2. 🔬 Methodology
3. 💡 Key Findings
4. 🚀 Research Impact (1-10)
5. ❓ Research Gaps left open
6. 🌍 Population studied (any bias?)
7. 📝 How to cite this work`,
        },
      ],
      max_tokens: 1000,
    });

    const analysis = aiRes.choices[0]?.message?.content || "Failed";
    return { content: [{ type: "text", text: `# 📄 ${title}\n👥 ${authors}\n\n${analysis}` }] };
  }
);

// ============================================================
// TOOL 5: Compare Papers
// ============================================================
server.registerTool(
  "compare_papers",
  {
    title: "Compare Two Papers",
    description: "Deep comparison of two papers with gap analysis",
    inputSchema: {
      arxiv_id_1: z.string().describe("First paper ID"),
      arxiv_id_2: z.string().describe("Second paper ID"),
    },
  },
  async ({ arxiv_id_1, arxiv_id_2 }) => {
    const fetch_paper = async (id: string) => {
      const url = `https://export.arxiv.org/api/query?id_list=${id}`;
      const res = await fetch(url);
      const text = await res.text();
      return {
        title: text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found",
        abstract: text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found",
      };
    };

    const [p1, p2] = await Promise.all([fetch_paper(arxiv_id_1), fetch_paper(arxiv_id_2)]);

    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher." },
        {
          role: "user",
          content: `Compare these papers:
Paper 1: ${p1.title}\n${p1.abstract}
Paper 2: ${p2.title}\n${p2.abstract}

Provide:
1. 📊 Comparison Table (markdown)
2. 🔍 Similarities
3. ⚡ Differences  
4. 🏆 Which is more impactful and why
5. 🚀 Combined research gaps`,
        },
      ],
      max_tokens: 1000,
    });

    const result = aiRes.choices[0]?.message?.content || "Failed";
    return { content: [{ type: "text", text: `# 📊 Paper Comparison\n**P1:** ${p1.title}\n**P2:** ${p2.title}\n\n${result}` }] };
  }
);

// ============================================================
// TOOL 6: Generate Analysis Code
// ============================================================
server.registerTool(
  "generate_analysis_code",
  {
    title: "Generate Analysis Code",
    description: "Generate Python neuroscience analysis code",
    inputSchema: {
      analysis_type: z.string().describe("Analysis type, e.g. 'EEG spike detection'"),
    },
  },
  async ({ analysis_type }) => {
    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Expert neuroscience Python programmer." },
        {
          role: "user",
          content: `Write complete, well-commented Python code for: ${analysis_type}
Use: numpy, matplotlib, scipy, mne (if EEG). Include example data and visualization.`,
        },
      ],
      max_tokens: 1500,
    });

    return { content: [{ type: "text", text: aiRes.choices[0]?.message?.content || "Failed" }] };
  }
);

// ============================================================
// Express Setup
// ============================================================
const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy", agent: "NeuroMind AI v4.0", tools: 6 });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "8080");
app.listen(port, () => {
  console.log(`✅ NeuroMind AI v4.0 running on http://localhost:${port}`);
  console.log(`🔬 Tools: find_research_gap, search_papers, search_pubmed, ai_summarize_paper, compare_papers, generate_analysis_code`);
});

process.on("SIGTERM", () => process.exit(0));