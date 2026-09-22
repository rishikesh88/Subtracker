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

/** Case-insensitive lookup, so a subscription detected from email can find its logo too. */
const BY_NAME = new Map(SERVICE_CATALOGUE.map((s) => [s.name.toLowerCase(), s]));

export function findService(name: string | null | undefined): CatalogueService | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.trim().toLowerCase());
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
