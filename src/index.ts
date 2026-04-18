import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import Groq from "groq-sdk";
import { ApifyClient } from "apify-client";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const apify = new ApifyClient({
  token: process.env.APIFY_API_KEY,
});

const server = new McpServer({
  name: "neuro-mcp-agent",
  version: "3.0.0",
});

// Tool 1: Search arXiv Papers
server.registerTool(
  "search_papers",
  {
    title: "Search Neuroscience Papers",
    description: "Search neuroscience research papers from arXiv",
    inputSchema: {
      query: z.string().describe("Search query, e.g. 'memory consolidation hippocampus'"),
    },
  },
  async ({ query }) => {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&cat=q-bio.NC&max_results=5`;
    const response = await fetch(url);
    const text = await response.text();

    const titles = [...text.matchAll(/<title>(.*?)<\/title>/gs)].slice(1).map(m => m[1].trim());
    const abstracts = [...text.matchAll(/<summary>(.*?)<\/summary>/gs)].map(m => m[1].trim().slice(0, 300));
    const links = [...text.matchAll(/<id>(.*?)<\/id>/gs)].slice(1).map(m => m[1].trim());

    let result = `🔍 Found ${titles.length} papers for: "${query}"\n\n`;
    titles.forEach((title, i) => {
      result += `📄 ${i + 1}. ${title}\n`;
      result += `🔗 ${links[i] || "N/A"}\n`;
      result += `📝 ${abstracts[i] || "N/A"}...\n\n`;
    });

    return { content: [{ type: "text", text: result }] };
  }
);

// Tool 2: Search PubMed Papers
server.registerTool(
  "search_pubmed",
  {
    title: "Search PubMed Papers",
    description: "Search biomedical and neuroscience papers from PubMed",
    inputSchema: {
      query: z.string().describe("Search query, e.g. 'hippocampal neurogenesis'"),
    },
  },
  async ({ query }) => {
    try {
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json() as { esearchresult: { idlist: string[] } };
      const ids = searchData.esearchresult.idlist;

      if (ids.length === 0) {
        return { content: [{ type: "text", text: `No PubMed papers found for: "${query}"` }] };
      }

      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
      const fetchRes = await fetch(fetchUrl);
      const fetchData = await fetchRes.json() as { result: Record<string, { title?: string; authors?: Array<{name: string}>; pubdate?: string; fulljournalname?: string }> };

      let result = `🔬 PubMed Results for: "${query}"\n\n`;
      ids.forEach((id, i) => {
        const paper = fetchData.result[id];
        if (paper) {
          result += `📄 ${i + 1}. ${paper.title || "N/A"}\n`;
          result += `👥 Authors: ${paper.authors?.slice(0, 3).map((a) => a.name).join(", ") || "N/A"}\n`;
          result += `📅 Date: ${paper.pubdate || "N/A"}\n`;
          result += `📰 Journal: ${paper.fulljournalname || "N/A"}\n`;
          result += `🔗 https://pubmed.ncbi.nlm.nih.gov/${id}/\n\n`;
        }
      });

      return { content: [{ type: "text", text: result }] };
    } catch {
      return { content: [{ type: "text", text: "PubMed search failed. Please try again." }] };
    }
  }
);

// Tool 3: AI Summarize Paper with Groq
server.registerTool(
  "ai_summarize_paper",
  {
    title: "AI Summarize Paper",
    description: "Use Groq AI to deeply summarize and analyze a neuroscience paper",
    inputSchema: {
      arxiv_id: z.string().describe("arXiv paper ID, e.g. '2301.12345'"),
    },
  },
  async ({ arxiv_id }) => {
    const url = `https://export.arxiv.org/api/query?id_list=${arxiv_id}`;
    const response = await fetch(url);
    const text = await response.text();

    const title = text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found";
    const abstract = text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found";
    const authors = [...text.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1].trim()).join(", ");

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher." },
        {
          role: "user",
          content: `Analyze this paper:
Title: ${title}
Authors: ${authors}
Abstract: ${abstract}

Provide:
1. 🎯 Main Contribution
2. 🔬 Methodology
3. 💡 Key Findings
4. 🚀 Research Impact
5. ❓ Research Gaps`,
        },
      ],
      max_tokens: 800,
    });

    const analysis = aiResponse.choices[0]?.message?.content || "Analysis failed";
    return { content: [{ type: "text", text: `📄 ${title}\n👥 ${authors}\n\n🤖 AI Analysis:\n${analysis}` }] };
  }
);

// Tool 4: Find Research Gap
server.registerTool(
  "find_research_gap",
  {
    title: "Find Research Gap",
    description: "Analyze multiple papers and find research gaps in neuroscience",
    inputSchema: {
      topic: z.string().describe("Research topic, e.g. 'deep learning EEG analysis'"),
    },
  },
  async ({ topic }) => {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&cat=q-bio.NC&max_results=8`;
    const response = await fetch(url);
    const text = await response.text();

    const titles = [...text.matchAll(/<title>(.*?)<\/title>/gs)].slice(1).map(m => m[1].trim());
    const abstracts = [...text.matchAll(/<summary>(.*?)<\/summary>/gs)].map(m => m[1].trim().slice(0, 200));

    const papersText = titles.map((t, i) => `Paper ${i+1}: ${t}\nAbstract: ${abstracts[i]}`).join("\n\n");

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher who identifies research gaps." },
        {
          role: "user",
          content: `Analyze these papers on "${topic}" and identify research gaps:

${papersText}

Provide:
1. 🔍 Current State of Research
2. ❌ What is Missing / Research Gaps
3. 💡 Suggested New Research Directions
4. 🏆 Most Promising Research Opportunity
5. 📝 Suggested Paper Title for New Research`,
        },
      ],
      max_tokens: 1000,
    });

    const gaps = aiResponse.choices[0]?.message?.content || "Analysis failed";
    return { content: [{ type: "text", text: `🔬 Research Gap Analysis: "${topic}"\n\n${gaps}` }] };
  }
);

// Tool 5: Compare Papers
server.registerTool(
  "compare_papers",
  {
    title: "Compare Two Papers",
    description: "Compare two neuroscience papers and find research gaps",
    inputSchema: {
      arxiv_id_1: z.string().describe("First arXiv paper ID"),
      arxiv_id_2: z.string().describe("Second arXiv paper ID"),
    },
  },
  async ({ arxiv_id_1, arxiv_id_2 }) => {
    const fetchPaper = async (id: string) => {
      const url = `https://export.arxiv.org/api/query?id_list=${id}`;
      const response = await fetch(url);
      const text = await response.text();
      const title = text.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || "Not found";
      const abstract = text.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Not found";
      return { title, abstract };
    };

    const [paper1, paper2] = await Promise.all([fetchPaper(arxiv_id_1), fetchPaper(arxiv_id_2)]);

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience researcher." },
        {
          role: "user",
          content: `Compare these papers:

Paper 1: ${paper1.title}
Abstract: ${paper1.abstract}

Paper 2: ${paper2.title}
Abstract: ${paper2.abstract}

Provide:
1. 🔍 Key Similarities
2. ⚡ Key Differences
3. 🏆 Which is more impactful
4. 🚀 Research gaps both leave open`,
        },
      ],
      max_tokens: 800,
    });

    const comparison = aiResponse.choices[0]?.message?.content || "Comparison failed";
    return { content: [{ type: "text", text: `📊 Comparison\n📄 Paper 1: ${paper1.title}\n📄 Paper 2: ${paper2.title}\n\n${comparison}` }] };
  }
);

// Tool 6: Generate Analysis Code
server.registerTool(
  "generate_analysis_code",
  {
    title: "Generate Analysis Code",
    description: "Generate Python code for neuroscience data analysis",
    inputSchema: {
      analysis_type: z.string().describe("Type of analysis, e.g. 'EEG spike detection'"),
    },
  },
  async ({ analysis_type }) => {
    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an expert neuroscience programmer. Write clean Python code." },
        {
          role: "user",
          content: `Write complete Python code for: ${analysis_type}
Requirements: Use numpy, matplotlib, scipy. Add comments. Include example usage.`,
        },
      ],
      max_tokens: 1000,
    });

    const code = aiResponse.choices[0]?.message?.content || "Code generation failed";
    return { content: [{ type: "text", text: code }] };
  }
);

// Express Setup
const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy", agent: "NeuroMind AI v3.0" });
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
  console.log(`✅ NeuroMind AI v3.0 running on http://localhost:${port}`);
  console.log(`🔬 Tools: search_papers, search_pubmed, ai_summarize_paper, find_research_gap, compare_papers, generate_analysis_code`);
});

process.on("SIGTERM", () => process.exit(0));