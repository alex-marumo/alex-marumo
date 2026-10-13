import { writeFileSync } from "node:fs";

const token = process.env.METRICS_TOKEN;
const login = process.env.GH_LOGIN;
if (!token || !login) throw new Error("METRICS_TOKEN and GH_LOGIN are required");

// Languages to leave out of the card, e.g. new Set(["HTML", "Jupyter Notebook"])
const EXCLUDE = new Set([]);
const TOP = 5;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-metrics",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

const QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      pageInfo { hasNextPage endCursor }
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

// ---------- fetch ----------
const bytes = new Map();
let contrib;
let after = null;
do {
  const { user } = await gql(QUERY, { login, after });
  contrib = user.contributionsCollection;
  for (const repo of user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      if (EXCLUDE.has(node.name)) continue;
      bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
    }
  }
  after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
} while (after);

const total = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
const top = [...bytes.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP)
  .map(([name, size]) => ({ name, share: size / total }));

// ---------- design tokens ----------
const FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace";
const W = 480, H = 228, PAD = 24;
const BG = "#0a0a0a", BORDER = "#1c1c1c", TEXT = "#c9c9c9", BRIGHT = "#e0e0e0";
const MUTED = "#666666", DIM = "#888888", TRACK = "#141414";
const SHADES = ["#e0e0e0", "#b0b0b0", "#8a8a8a", "#6a6a6a", "#4a4a4a"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const frame = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${BG}" stroke="${BORDER}"/>
${inner}
</svg>
`;

// ---------- card 1: languages ----------
const barW = W - PAD * 2;
let x = PAD;
const segments = top
  .map((l, i) => {
    const w = barW * l.share;
    const seg = `<rect x="${x.toFixed(2)}" y="50" width="${w.toFixed(2)}" height="4" fill="${SHADES[i]}"/>`;
    x += w;
    return seg;
  })
  .join("\n");

const rows = top
  .map((l, i) => {
    const y = 90 + i * 28;
    return `<circle cx="${PAD + 3}" cy="${y - 4}" r="3" fill="${SHADES[i]}"/>
<text x="${PAD + 16}" y="${y}" font-size="13" fill="${TEXT}">${esc(l.name)}</text>
<text x="${W - PAD}" y="${y}" font-size="13" fill="${DIM}" text-anchor="end">${(l.share * 100).toFixed(1)}%</text>`;
  })
  .join("\n");

const languages = frame(`<text x="${PAD}" y="32" font-size="11" fill="${MUTED}" letter-spacing="1.5">most used languages</text>
<clipPath id="bar"><rect x="${PAD}" y="50" width="${barW}" height="4" rx="2"/></clipPath>
<g clip-path="url(#bar)">
<rect x="${PAD}" y="50" width="${barW}" height="4" fill="${TRACK}"/>
${segments}
</g>
${rows}`);

// ---------- card 2: activity ----------
const stats = [
  ["commits", contrib.totalCommitContributions],
  ["pull requests", contrib.totalPullRequestContributions],
  ["reviews", contrib.totalPullRequestReviewContributions],
  ["issues", contrib.totalIssueContributions],
];

const cells = stats
  .map(([label, value], i) => {
    const cx = PAD + (i % 2) * 228;
    const cy = 100 + Math.floor(i / 2) * 70;
    return `<text x="${cx}" y="${cy}" font-size="30" fill="${BRIGHT}">${value.toLocaleString("en-US")}</text>
<text x="${cx}" y="${cy + 22}" font-size="11" fill="${MUTED}" letter-spacing="1.5">${label}</text>`;
  })
  .join("\n");

const overview = frame(`<text x="${PAD}" y="32" font-size="11" fill="${MUTED}" letter-spacing="1.5">activity · last 12 months</text>
${cells}`);

writeFileSync("metrics.plugin.languages.svg", languages);
writeFileSync("metrics.plugin.overview.svg", overview);
console.log("wrote 2 cards");
