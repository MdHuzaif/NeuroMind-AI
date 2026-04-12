import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const server = new McpServer({
  name: "neuro-mcp-agent",
  version: "2.0.0",
});

// Tool 1: Search Papers
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

    let result = `Found ${titles.length} papers for: "${query}"\n\n`;
    titles.forEach((title, i) => {
      result += `📄 ${i + 1}. ${title}\n`;
      result += `🔗 ${links[i] || "N/A"}\n`;
      result += `📝 ${abstracts[i] || "N/A"}...\n\n`;
    });

    return { content: [{ type: "text", text: result }] };
  }
);

// Tool 2: AI Summary with Groq
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

    const titleMatch = text.match(/<title>(.*?)<\/title>/s);
    const abstractMatch = text.match(/<summary>(.*?)<\/summary>/s);
    const authorsMatches = [...text.matchAll(/<name>(.*?)<\/name>/g)];

    const title = titleMatch ? titleMatch[1].trim() : "Not found";
    const abstract = abstractMatch ? abstractMatch[1].trim() : "Not found";
    const authors = authorsMatches.map(m => m[1].trim()).join(", ");

    // Groq AI Analysis
    const aiResponse = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: "You are an expert neuroscience researcher. Analyze papers and provide insights.",
        },
        {
          role: "user",
          content: `Analyze this neuroscience paper:
Title: ${title}
Authors: ${authors}
Abstract: ${abstract}

Provide:
1. 🎯 Main Contribution (2-3 sentences)
2. 🔬 Methodology used
3. 💡 Key Findings
4. 🚀 Research Impact
5. ❓ Research Gaps / Future Work`,
        },
      ],
      max_tokens: 800,
    });

    const aiAnalysis = aiResponse.choices[0]?.message?.content || "Analysis failed";
    const result = `📄 Title: ${title}\n👥 Authors: ${authors}\n\n🤖 AI Analysis:\n${aiAnalysis}`;

    return { content: [{ type: "text", text: result }] };
  }
);

// Tool 3: Compare Papers
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

    const paper1 = await fetchPaper(arxiv_id_1);
    const paper2 = await fetchPaper(arxiv_id_2);

    const aiResponse = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: "You are an expert neuroscience researcher.",
        },
        {
          role: "user",
          content: `Compare these two neuroscience papers:

Paper 1: ${paper1.title}
Abstract: ${paper1.abstract}

Paper 2: ${paper2.title}
Abstract: ${paper2.abstract}

Provide:
1. 🔍 Key Similarities
2. ⚡ Key Differences
3. 🏆 Which is more impactful and why
4. 🚀 Research gaps both papers leave open`,
        },
      ],
      max_tokens: 800,
    });

    const comparison = aiResponse.choices[0]?.message?.content || "Comparison failed";
    const result = `📊 Paper Comparison\n\n📄 Paper 1: ${paper1.title}\n📄 Paper 2: ${paper2.title}\n\n🤖 AI Comparison:\n${comparison}`;

    return { content: [{ type: "text", text: result }] };
  }
);

// Tool 4: Generate Analysis Code
server.registerTool(
  "generate_analysis_code",
  {
    title: "Generate Analysis Code",
    description: "Generate Python code for neuroscience data analysis using AI",
    inputSchema: {
      analysis_type: z.string().describe("Type of analysis, e.g. 'EEG spike detection', 'fMRI preprocessing'"),
    },
  },
  async ({ analysis_type }) => {
    const aiResponse = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: "You are an expert neuroscience programmer. Write clean, well-commented Python code.",
        },
        {
          role: "user",
          content: `Write complete Python code for: ${analysis_type}
          
Requirements:
- Use numpy, matplotlib, scipy
- Add detailed comments
- Include example usage
- Add visualization`,
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
  res.status(200).json({ status: "healthy", agent: "NeuroMind AI v2.0" });
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
  console.log(`✅ NeuroMind AI v2.0 running on http://localhost:${port}`);
  console.log(`🔬 Tools: search_papers, ai_summarize_paper, compare_papers, generate_analysis_code`);
});

process.on("SIGTERM", () => process.exit(0));