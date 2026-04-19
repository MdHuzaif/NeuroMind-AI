import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const server = new McpServer({
  name: "neuro-mcp-agent",
  version: "4.1.0",
});

async function fetchArxiv(query: string, maxResults = 10) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}&sortBy=relevance`;
  const res = await fetch(url);
  const text = await res.text();
  const titles = [...text.matchAll(/<title>(.*?)<\/title>/gs)].slice(1).map(m => m[1].trim());
  const abstracts = [...text.matchAll(/<summary>(.*?)<\/summary>/gs)].map(m => m[1].trim());
  const links = [...text.matchAll(/<id>(.*?)<\/id>/gs)].slice(1).map(m => m[1].trim());
  const years = [...text.matchAll(/<published>(.*?)<\/published>/gs)].map(m => m[1].trim().slice(0, 4));
  return titles.map((title, i) => ({
    title, abstract: abstracts[i] || "", link: links[i] || "",
    year: years[i] || "N/A", source: "arXiv", citations: 0,
  }));
}

async function fetchSemanticScholar(query: string, maxResults = 10) {
  try {
    await new Promise(r => setTimeout(r, 1000));
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,abstract,citationCount,year,authors,externalIds`;
    const res = await fetch(url, { headers: { "User-Agent": "NeuroMindAI/4.1" } });
    const data = await res.json() as { data: Array<{ title: string; abstract: string; citationCount: number; year: number; authors: Array<{name: string}>; externalIds: { ArXiv?: string } }> };
    return (data.data || []).map(p => ({
      title: p.title || "N/A", abstract: p.abstract || "",
      link: p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : "",
      year: String(p.year || "N/A"), source: "Semantic Scholar",
      citations: p.citationCount || 0,
      authors: p.authors?.slice(0, 3).map(a => a.name).join(", ") || "N/A",
    }));
  } catch { return []; }
}

// ============================================================
// TOOL 1: Find Research Gap (PhD Level)
// ============================================================
server.registerTool(
  "find_research_gap",
  {
    title: "🔬 Find Research Gap (PhD Level)",
    description: "Advanced research gap analysis: Dual search arXiv + Semantic Scholar, analyze 10 papers with citation counts, novelty scoring (1-10), Bangladesh/LMIC context, comparative table, academic statements for scholarship proposals, and 4 research directions",
    inputSchema: {
      topic: z.string().describe("Research topic, e.g. 'EEG deep learning seizure detection Bangladesh'"),
    },
  },
  async ({ topic }) => {
    const [arxivPapers, s2Papers] = await Promise.all([
      fetchArxiv(topic, 8),
      fetchSemanticScholar(topic, 8),
    ]);

    const allPapers = [...arxivPapers, ...s2Papers];
    const seen = new Set<string>();
    const unique = allPapers.filter(p => {
      const key = p.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const top10 = unique.sort((a, b) => b.citations - a.citations).slice(0, 10);
    const top5 = top10.slice(0, 5);
    const papersText = top5.map((p, i) =>
      `Paper ${i+1}: ${p.title} (${p.year}) [Citations: ${p.citations}]\nAbstract: ${p.abstract}`
    ).join("\n\n---\n\n");

    const yearCounts: Record<string, number> = {};
    top10.forEach(p => { yearCounts[p.year] = (yearCounts[p.year] || 0) + 1; });
    const trendText = Object.entries(yearCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, count]) => `${year}: ${"█".repeat(count)} (${count})`)
      .join("\n");

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

PUBLICATION TREND DATA:
${trendText}

IMPORTANT OUTPUT STRUCTURE (Academic PhD Scholarship Level):

## 1. 📊 BASELINE ANALYSIS
Summarize what current research already does: models used, accuracy achieved, datasets used, and populations studied.

## 2. 📋 COMPARATIVE TABLE
Generate a markdown table with columns:
| Paper | Year | Method | Dataset | Population | XAI | Privacy | Key Limitation | Citations |

## 3. 🌐 GLOBAL RESEARCH GAPS (Technical)
List 5 core technical limitations with novelty scores:
- **Gap Name**: Description
- **Novelty Score**: X/10
- **Why Critical**: 1 sentence
- **Supporting Evidence**: Which paper(s) show this gap

## 4. 🇧🇩 LOCAL CONTEXT GAPS (Bangladesh/LMIC - CRITICAL)
Identify 5-7 specific challenges for Low-Resource Settings. For each:
- **Challenge**: Description
- **Novelty Score**: X/10
- **Local Impact**: Why this matters for Bangladesh specifically
Check these dimensions:
  - Dataset availability (Local vs Foreign data)
  - Hospital/Clinical integration feasibility
  - Low-cost device compatibility
  - Language/Usability barriers (Bengali interface?)
  - Rural/Remote deployment challenges
  - Internet connectivity constraints
  - Power supply reliability

## 5. 📝 READY-TO-USE ACADEMIC STATEMENTS
Provide 3 powerful quoted statements suitable for PhD scholarship proposal introduction. Format:
"[Statement]" — suitable for [Introduction/Problem Statement/Motivation section]

## 6. 🚀 RESEARCH DIRECTIONS (4 Distinct Paths)
- **Path 1 - Dataset Focused**: How to build/collect local data
- **Path 2 - Deployment Focused**: Real-world clinical integration
- **Path 3 - Algorithm Advanced**: Novel technical contribution
- **Path 4 - Unique/Niche**: Unexplored angle nobody has tried

## 7. 📈 TREND ANALYSIS
Based on publication years provided, answer:
- Is this field growing or declining?
- Best time to enter this field?
- Which sub-topic is hottest right now?

## 8. 🏆 TOP 3 PAPERS TO READ FIRST
With specific reasons why each is essential.

## 9. 💡 MOST PROMISING OPPORTUNITY
One specific, actionable research idea with:
- Suggested paper title
- Methodology outline (3-4 steps)
- Expected contribution
- Target conference/journal (IEEE, NeurIPS, etc.)
- Estimated novelty: X/10

Tone: Academic, persuasive, suitable for PhD scholarship applications.
Focus: Real-world impact in Bangladesh and South Asia.`,
        },
      ],
      max_tokens: 2000,
    });

    const analysis = aiResponse.choices[0]?.message?.content || "Analysis failed";
    const output = `# 🧠 NeuroMind AI v4.1 - Research Gap Analysis
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
// TOOL 2: Search Papers
// ============================================================
server.registerTool(
  "search_papers",
  {
    title: "Search Papers (Dual Source)",
    description: "Search papers from arXiv AND Semantic Scholar with citation counts",
    inputSchema: { query: z.string().describe("Search query") },
  },
  async ({ query }) => {
    const [arxiv, s2] = await Promise.all([fetchArxiv(query, 5), fetchSemanticScholar(query, 5)]);
    const all = [...arxiv, ...s2].sort((a, b) => b.citations - a.citations);
    let result = `# 🔍 Search Results: "${query}"\n\n`;
    all.forEach((p, i) => {
      result += `## ${i+1}. ${p.title}\n`;
      result += `📅 ${p.year} | 📊 Citations: ${p.citations} | 📰 ${p.source}\n`;
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
    inputSchema: { query: z.string().describe("Search query") },
  },
  async ({ query }) => {
    try {
      const searchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`);
      const searchData = await searchRes.json() as { esearchresult: { idlist: string[] } };
      const ids = searchData.esearchresult.idlist;
      if (ids.length === 0) return { content: [{ type: "text", text: `No PubMed results for: "${query}"` }] };
      const fetchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`);
      const fetchData = await fetchRes.json() as { result: Record<string, { title?: string; authors?: Array<{name: string}>; pubdate?: string; fulljournalname?: string }> };
      let result = `# 🔬 PubMed: "${query}"\n\n`;
      ids.forEach((id, i) => {
        const p = fetchData.result[id];
        if (p) {
          result += `${i+1}. **${p.title}**\n👥 ${p.authors?.slice(0, 3).map(a => a.name).join(", ")}\n📅 ${p.pubdate} | 📰 ${p.fulljournalname}\n🔗 https://pubmed.ncbi.nlm.nih.gov/${id}/\n\n`;
        }
      });
      return { content: [{ type: "text", text: result }] };
    } catch { return { content: [{ type: "text", text: "PubMed search failed." }] }; }
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
    inputSchema: { arxiv_id: z.string().describe("arXiv paper ID") },
  },
  async ({ arxiv_id }) => {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${arxiv_id}`);
    const text = await res.text();
    const title = text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found";
    const abstract = text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found";
    const authors = [...text.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1].trim()).join(", ");
    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher." },
        { role: "user", content: `Analyze this paper:
Title: ${title}
Authors: ${authors}
Abstract: ${abstract}

Provide:
1. 🎯 Main Contribution
2. 🔬 Methodology
3. 💡 Key Findings
4. 🚀 Research Impact (1-10)
5. ❓ Research Gaps
6. 🌍 Population bias?
7. 📝 Citation format` },
      ],
      max_tokens: 1000,
    });
    return { content: [{ type: "text", text: `# 📄 ${title}\n👥 ${authors}\n\n${aiRes.choices[0]?.message?.content || "Failed"}` }] };
  }
);

// ============================================================
// TOOL 5: Compare Papers
// ============================================================
server.registerTool(
  "compare_papers",
  {
    title: "Compare Two Papers",
    description: "Deep comparison of two papers",
    inputSchema: {
      arxiv_id_1: z.string().describe("First paper ID"),
      arxiv_id_2: z.string().describe("Second paper ID"),
    },
  },
  async ({ arxiv_id_1, arxiv_id_2 }) => {
    const fp = async (id: string) => {
      const res = await fetch(`https://export.arxiv.org/api/query?id_list=${id}`);
      const text = await res.text();
      return {
        title: text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found",
        abstract: text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found",
      };
    };
    const [p1, p2] = await Promise.all([fp(arxiv_id_1), fp(arxiv_id_2)]);
    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Expert neuroscience researcher." },
        { role: "user", content: `Compare:
P1: ${p1.title}\n${p1.abstract}
P2: ${p2.title}\n${p2.abstract}
Provide: 1.📊 Table 2.🔍 Similarities 3.⚡ Differences 4.🏆 More impactful 5.🚀 Combined gaps` },
      ],
      max_tokens: 1000,
    });
    return { content: [{ type: "text", text: `# 📊 Comparison\n**P1:** ${p1.title}\n**P2:** ${p2.title}\n\n${aiRes.choices[0]?.message?.content || "Failed"}` }] };
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
    inputSchema: { analysis_type: z.string().describe("Analysis type") },
  },
  async ({ analysis_type }) => {
    const aiRes = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Expert neuroscience Python programmer." },
        { role: "user", content: `Write complete Python code for: ${analysis_type}. Use numpy, matplotlib, scipy, mne. Add comments and example usage.` },
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
  res.status(200).json({ status: "healthy", agent: "NeuroMind AI v4.1", tools: 6 });
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
  console.log(`✅ NeuroMind AI v4.1 running on http://localhost:${port}`);
  console.log(`🔬 Tools: find_research_gap, search_papers, search_pubmed, ai_summarize_paper, compare_papers, generate_analysis_code`);
});

process.on("SIGTERM", () => process.exit(0));