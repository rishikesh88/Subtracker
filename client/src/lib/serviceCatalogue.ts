/**
 * The services offered on the first step of "Add subscription".
 *
 * Thirty business-software subscriptions, chosen for how likely a company is
 * to actually pay for one rather than for brand recognition. Anything not
 * here is still addable by typing its name -- the catalogue is a shortcut,
 * not a whitelist.
 *
 * `slug` is a Simple Icons identifier. Nine of these thirty are `null`,
 * because Simple Icons no longer carries them -- Slack, Salesforce, Adobe,
 * AWS, Azure, Microsoft 365, Canva, OpenAI and Monday.com have all been
 * withdrawn at the trademark holders' request. Checked against the package
 * itself rather than assumed, which is why the list is exact.
 *
 * `domain` is what those nine fall back to, and it is filled in for every
 * row so the order can be changed without revisiting them.
 */
export interface CatalogueService {
  name: string;
  /** Simple Icons id, or null where Simple Icons has withdrawn the brand. */
  slug: string | null;
  domain: string;
  category: string;
}

export const SERVICE_CATALOGUE: CatalogueService[] = [
  // Collaboration
  { name: "Slack",                slug: null,                 domain: "slack.com",              category: "Collaboration" },
  { name: "Notion",               slug: "notion",             domain: "notion.so",              category: "Collaboration" },
  { name: "Google Workspace",     slug: "google",             domain: "workspace.google.com",   category: "Collaboration" },
  { name: "Microsoft 365",        slug: null,                 domain: "microsoft.com",          category: "Collaboration" },
  { name: "Zoom",                 slug: "zoom",               domain: "zoom.us",                category: "Collaboration" },
  { name: "Atlassian",            slug: "atlassian",          domain: "atlassian.com",          category: "Collaboration" },

  // Work management
  { name: "Asana",                slug: "asana",              domain: "asana.com",              category: "Work management" },
  { name: "Linear",               slug: "linear",             domain: "linear.app",             category: "Work management" },
  { name: "Monday.com",           slug: null,                 domain: "monday.com",             category: "Work management" },
  { name: "Airtable",             slug: "airtable",           domain: "airtable.com",           category: "Work management" },

  // Design
  { name: "Figma",                slug: "figma",              domain: "figma.com",              category: "Design" },
  { name: "Adobe Creative Cloud", slug: null,                 domain: "adobe.com",              category: "Design" },
  { name: "Canva",                slug: null,                 domain: "canva.com",              category: "Design" },

  // Developer and infrastructure
  { name: "GitHub",               slug: "github",             domain: "github.com",             category: "Developer" },
  { name: "Amazon Web Services",  slug: null,                 domain: "aws.amazon.com",         category: "Developer" },
  { name: "Google Cloud",         slug: "googlecloud",        domain: "cloud.google.com",       category: "Developer" },
  { name: "Microsoft Azure",      slug: null,                 domain: "azure.microsoft.com",    category: "Developer" },
  { name: "Vercel",               slug: "vercel",             domain: "vercel.com",             category: "Developer" },
  { name: "Cloudflare",           slug: "cloudflare",         domain: "cloudflare.com",         category: "Developer" },
  { name: "Sentry",               slug: "sentry",             domain: "sentry.io",              category: "Developer" },

  // AI
  { name: "OpenAI",               slug: null,                 domain: "openai.com",             category: "AI" },
  { name: "Anthropic",            slug: "anthropic",          domain: "anthropic.com",          category: "AI" },
  { name: "GitHub Copilot",       slug: "githubcopilot",      domain: "github.com",             category: "AI" },
  { name: "Perplexity",           slug: "perplexity",         domain: "perplexity.ai",          category: "AI" },

  // Sales and support
  { name: "HubSpot",              slug: "hubspot",            domain: "hubspot.com",            category: "Sales" },
  { name: "Salesforce",           slug: null,                 domain: "salesforce.com",         category: "Sales" },
  { name: "Intercom",             slug: "intercom",           domain: "intercom.com",           category: "Sales" },

  // Finance and operations
  { name: "Stripe",               slug: "stripe",             domain: "stripe.com",             category: "Finance" },
  { name: "QuickBooks",           slug: "quickbooks",         domain: "quickbooks.intuit.com",  category: "Finance" },
  { name: "Xero",                 slug: "xero",               domain: "xero.com",               category: "Finance" },
];

/** Case-insensitive lookup, so a subscription detected from email can find its logo too. */
const BY_NAME = new Map(SERVICE_CATALOGUE.map((s) => [s.name.toLowerCase(), s]));

export function findService(name: string | null | undefined): CatalogueService | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Substring match on the name, for the search box on step one. */
export function searchServices(query: string): CatalogueService[] {
  const q = query.trim().toLowerCase();
  if (!q) return SERVICE_CATALOGUE;
  return SERVICE_CATALOGUE.filter((s) => s.name.toLowerCase().includes(q));
}
