# ArtemisTwin 🚀

**Quantitative Earth-to-Moon & Mars Analog Screening Platform**

ArtemisTwin is an interactive screening and educational tool designed to compare documented terrestrial analog environments with lunar and Martian exploration target envelopes. It facilitates candidate site assessment across environmental, terrain, and operational dimensions to support mission planning, rover mobility studies, and analog research.

---

## ✨ Features

- **Interactive Candidate Map**: Explore and filter terrestrial analog candidate sites worldwide.
- **Target Comparisons**: Contrast terrestrial environments against lunar and Martian terrain and surface profiles.
- **Twin Viewer & Transect Profiling**: Side-by-side comparative transect visualization and measurement metrics.
- **Site Dossiers & Metrics**: Structured site profiles, environmental indicators, data completeness metrics, and gap analysis.
- **Client-Side Architecture**: High-performance static web application requiring no login or runtime user keys.

---

## 🌐 Live Web Demo

Access the live application on Vercel:
**[https://artemistwin.vercel.app/](https://artemistwin.vercel.app/)**

---

## 💻 Local Quickstart

### Prerequisites
- Python 3.8+ (for local HTTP server preview) or any static web server

### Running Locally
Run the lightweight preview server from the repository root:

```bash
python serve.py --port 8080
```

Then open your browser at **`http://127.0.0.1:8080/`**.

> **Note**: Avoid opening `site/index.html` directly with the `file://` protocol, as browser security policies block module scripts and local data fetches.

---

## 📁 Project Structure

```text
├── site/               # Production-ready static web application
│   ├── index.html      # Main application entry point
│   ├── assets/         # Bundled scripts, styles, and web fonts
│   ├── data/           # Pre-processed static catalog and model datasets
│   └── img/            # Optimized imagery and icons
├── src/                # Modular frontend source code
├── serve.py            # Local HTTP development server
└── vercel.json         # Deployment configuration for Vercel
```

---

## 🤖 AI & Tooling Attributions

This project leveraged modern artificial intelligence tools across its design and development lifecycle:

- **Frontend Development**: 
  - **OpenAI Codex** and **Anthropic Claude** were utilized for designing UI modules, interactive components, responsive styling, and client-side logic.
- **Backend & Data Pipeline**: 
  - **Google DeepMind Antigravity** and **DeepSeek Harness** were utilized for modeling data processing pipelines, analog screening workflows, algorithmic evaluations, and project orchestration.
