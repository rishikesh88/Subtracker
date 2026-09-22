/**
 * The services offered on the first step of "Add subscription".
 *
 * Thirty business-software subscriptions, chosen for how likely a company is
 * to actually pay for one rather than for brand recognition. Anything not
 * here is still addable by typing its name -- the catalogue is a shortcut,
 * not a whitelist.
 *
 * `domain` is what fetches the logo: Brandfetch is keyed on it, and all
 * thirty were checked in a browser against the real client id before this
 * list was trusted. A domain Brandfetch does not know falls back to the
 * service's first letter, so getting one wrong is visible, not silent.
 */
export interface CatalogueService {
  name: string;
  domain: string;
  category: string;
  /** One plain line on what it is. Shown on the card in the picker. */
  description: string;
}

export const SERVICE_CATALOGUE: CatalogueService[] = [
  // Collaboration
  { name: "Slack",                domain: "slack.com",              category: "Collaboration",
    description: "Team messaging in channels" },
  { name: "Notion",               domain: "notion.so",              category: "Collaboration",
    description: "Notes, docs and wikis in one place" },
  { name: "Google Workspace",     domain: "workspace.google.com",   category: "Collaboration",
    description: "Gmail, Docs, Drive and Calendar" },
  { name: "Microsoft 365",        domain: "microsoft.com",          category: "Collaboration",
    description: "Word, Excel, Outlook and Teams" },
  { name: "Zoom",                 domain: "zoom.us",                category: "Collaboration",
    description: "Video calls and webinars" },
  { name: "Atlassian",            domain: "atlassian.com",          category: "Collaboration",
    description: "Jira, Confluence and Bitbucket" },

  // Work management
  { name: "Asana",                domain: "asana.com",              category: "Work management",
    description: "Projects, tasks and who owns what" },
  { name: "Linear",               domain: "linear.app",             category: "Work management",
    description: "Issue tracking for software teams" },
  { name: "Monday.com",           domain: "monday.com",             category: "Work management",
    description: "Boards for planning work" },
  { name: "Airtable",             domain: "airtable.com",           category: "Work management",
    description: "Spreadsheets that work like a database" },

  // Design
  { name: "Figma",                domain: "figma.com",              category: "Design",
    description: "Design files and prototypes" },
  { name: "Adobe Creative Cloud", domain: "adobe.com",              category: "Design",
    description: "Photoshop, Illustrator and the rest" },
  { name: "Canva",                domain: "canva.com",              category: "Design",
    description: "Quick design without a designer" },

  // Developer and infrastructure
  { name: "GitHub",               domain: "github.com",             category: "Developer",
    description: "Code hosting and pull requests" },
  { name: "Amazon Web Services",  domain: "aws.amazon.com",         category: "Developer",
    description: "Cloud servers, storage and databases" },
  { name: "Google Cloud",         domain: "cloud.google.com",       category: "Developer",
    description: "Google's cloud servers and storage" },
  { name: "Microsoft Azure",      domain: "azure.microsoft.com",    category: "Developer",
    description: "Microsoft's cloud servers and storage" },
  { name: "Vercel",               domain: "vercel.com",             category: "Developer",
    description: "Hosting for web apps" },
  { name: "Cloudflare",           domain: "cloudflare.com",         category: "Developer",
    description: "Domains, DNS and protection from attacks" },
  { name: "Sentry",               domain: "sentry.io",              category: "Developer",
    description: "Tells you when your app breaks" },

  // AI
  { name: "OpenAI",               domain: "openai.com",             category: "AI",
    description: "ChatGPT and the API behind it" },
  { name: "Anthropic",            domain: "anthropic.com",          category: "AI",
    description: "Claude and the API behind it" },
  { name: "GitHub Copilot",       domain: "github.com",             category: "AI",
    description: "Code suggestions while you type" },
  { name: "Perplexity",           domain: "perplexity.ai",          category: "AI",
    description: "Search that answers in sentences" },

  // Sales and support
  { name: "HubSpot",              domain: "hubspot.com",            category: "Sales",
    description: "Marketing, sales and customer records" },
  { name: "Salesforce",           domain: "salesforce.com",         category: "Sales",
    description: "Customer records and sales pipeline" },
  { name: "Intercom",             domain: "intercom.com",           category: "Sales",
    description: "Chat and support inside your product" },

  // Finance and operations
  { name: "Stripe",               domain: "stripe.com",             category: "Finance",
    description: "Takes card payments" },
  { name: "QuickBooks",           domain: "quickbooks.intuit.com",  category: "Finance",
    description: "Bookkeeping, invoices and tax" },
  { name: "Xero",                 domain: "xero.com",               category: "Finance",
    description: "Accounting and bank reconciliation" },
];

const BY_NAME = new Map(SERVICE_CATALOGUE.map((s) => [s.name.toLowerCase(), s]));

/* Longest first, so "Google Workspace" is tried before a bare "Google" would be. */
const BY_LENGTH = [...SERVICE_CATALOGUE].sort((a, b) => b.name.length - a.name.length);

/**
 * Find a catalogue entry for a subscription's name.
 *
 * Exact match first, then a prefix match at a word boundary. The prefix pass
 * exists because a subscription found in email is named by whatever the
 * receipt called it -- "Figma Professional", "Slack Pro" -- which never
 * matches a catalogue row exactly, so every one of them fell back to a letter.
 */
export function findService(name: string | null | undefined): CatalogueService | undefined {
  if (!name) return undefined;
  const q = name.trim().toLowerCase();
  if (!q) return undefined;

  const exact = BY_NAME.get(q);
  if (exact) return exact;

  return BY_LENGTH.find((s) => {
    const n = s.name.toLowerCase();
    return q.startsWith(n) && (q.length === n.length || /[\s(:\u2013-]/.test(q[n.length]));
  });
}

/**
 * The brand's domain, taken from the address the receipt came from.
 *
 * This is what gives a logo to everything the catalogue does not list. A
 * subscription detected in email carries the sender's address, and for a
 * billing email that sender is the brand -- so `billing@netflix.com` is
 * Netflix's domain without Netflix needing to be in any list.
 *
 * Returns the host, and the host minus its first label when there are three
 * or more, so `mail.netflix.com` offers `netflix.com` as a second try. Both
 * are candidates rather than a guess: the caller tries them in order.
 */
export function domainsFromEmail(email: string | null | undefined): string[] {
  if (!email) return [];
  const at = email.lastIndexOf("@");
  if (at < 0) return [];

  const host = email.slice(at + 1).trim().toLowerCase().replace(/[>\s]+$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return [];

  return labels.length >= 3 ? [host, labels.slice(1).join(".")] : [host];
}

/**
 * What the picker shows.
 *
 * A search reaches across every category -- narrowing to the open tab would
 * hide the thing being searched for, which is the opposite of what typing a
 * name is asking for. The category only filters while the search is empty.
 */
export function browseServices(query: string, category: string | null): CatalogueService[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return SERVICE_CATALOGUE.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }
  if (category) return SERVICE_CATALOGUE.filter((s) => s.category === category);
  return SERVICE_CATALOGUE;
}

/** Categories in the order the tabs should show them. Derived, so adding a
 *  service to a new category needs no second edit here. */
export const SERVICE_CATEGORIES: string[] = Array.from(
  new Set(SERVICE_CATALOGUE.map((s) => s.category))
);
