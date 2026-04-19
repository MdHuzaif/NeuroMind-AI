# 🧠 NeuroMind AI — Neuroscience Research Assistant

> AI-powered MCP agent that helps researchers find papers, identify research gaps, and generate analysis code — with special focus on Bangladesh/South Asia.

[![Live on MCPize](https://img.shields.io/badge/MCPize-Live-purple)](https://mcpize.com/mcp/neuro-mcp-agent)
[![GitHub](https://img.shields.io/badge/GitHub-NeuroMind--AI-black)](https://github.com/MdHuzaif/NeuroMind-AI)
[![Free](https://img.shields.io/badge/Cost-Free-green)]()

---

## 🚀 What is NeuroMind AI?

NeuroMind AI is an MCP (Model Context Protocol) server that connects directly to VS Code, Claude Desktop, and Cursor IDE. It helps neuroscience researchers:

- 🔍 Search papers from **arXiv + Semantic Scholar** simultaneously
- 📊 Find **research gaps** with novelty scoring (1-10)
- 🌍 Identify **geographic gaps** (Bangladesh, South Asia, LMICs)
- 🤖 Get **AI-powered paper summaries** using Groq LLM
- 🐍 Generate **Python analysis code** for EEG/fMRI data
- 📈 Analyze **publication trends** over time

---

## 🛠️ Tools Available (6 Tools)

| Tool | Description |
|------|-------------|
| `find_research_gap` | Analyze 10 papers, find gaps with novelty scores |
| `search_papers` | Search arXiv + Semantic Scholar with citation counts |
| `search_pubmed` | Search biomedical papers from PubMed |
| `ai_summarize_paper` | Deep AI analysis of any arXiv paper |
| `compare_papers` | Compare two papers side by side |
| `generate_analysis_code` | Generate Python code for EEG/fMRI analysis |

---

## ⚡ Quick Start

### Option 1: Use in MCPize Playground (No Setup)
👉 [https://mcpize.com/mcp/neuro-mcp-agent/playground](https://mcpize.com/mcp/neuro-mcp-agent/playground)

### Option 2: Connect to VS Code
Add to your `.vscode/mcp.json`:
```json
{
  "servers": {
    "neuro-mcp-agent": {
      "type": "http",
      "url": "https://neuro-mcp-agent.mcpize.run/mcp"
    }
  }
}
```

### Option 3: Run Locally
```bash
git clone https://github.com/MdHuzaif/NeuroMind-AI.git
cd NeuroMind-AI
npm install
echo "GROQ_API_KEY=your_key_here" > .env
npm run dev
```

---

## 💡 Example Queries

```
Find research gap in EEG seizure detection Bangladesh
```
```
Search papers on hippocampal memory consolidation
```
```
Summarize paper 2005.08620
```