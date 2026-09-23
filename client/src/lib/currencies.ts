/**
 * The currencies this app can actually work in.
 *
 * One list, because there used to be three and they disagreed. Onboarding
 * offered ten, the dashboard picker offered four, and the server could
 * convert four. Choosing AED from the country step therefore produced a
 * dashboard that could not convert into it, could not offer it back in the
 * picker, and -- worst of all -- printed the rupee total under a dirham sign.
 *
 * Adding a currency means adding it here, to SUPPORTED_CURRENCIES on the
 * server, and nowhere else. The two are checked against each other by a test.
 */
export interface SupportedCurrency {
  code: string;
  name: string;
  symbol: string;
  /** Countries whose selection at onboarding implies this currency. */
  countries: { code: string; name: string }[];
}

export const CURRENCIES: SupportedCurrency[] = [
  { code: "USD", name: "US Dollar",         symbol: "$",   countries: [{ code: "US", name: "United States" }] },
  { code: "EUR", name: "Euro",              symbol: "€",   countries: [{ code: "EU", name: "European Union" }] },
  { code: "GBP", name: "British Pound",     symbol: "£",   countries: [{ code: "GB", name: "United Kingdom" }] },
  { code: "INR", name: "Indian Rupee",      symbol: "₹",   countries: [{ code: "IN", name: "India" }] },
  { code: "AED", name: "UAE Dirham",        symbol: "AED", countries: [{ code: "AE", name: "United Arab Emirates" }] },
  { code: "CAD", name: "Canadian Dollar",   symbol: "CA$", countries: [{ code: "CA", name: "Canada" }] },
  { code: "AUD", name: "Australian Dollar", symbol: "A$",  countries: [{ code: "AU", name: "Australia" }] },
  { code: "SGD", name: "Singapore Dollar",  symbol: "S$",  countries: [{ code: "SG", name: "Singapore" }] },
  { code: "JPY", name: "Japanese Yen",      symbol: "¥",   countries: [{ code: "JP", name: "Japan" }] },
  { code: "CNY", name: "Chinese Yuan",      symbol: "¥",   countries: [{ code: "CN", name: "China" }] },
];

/** Every country the onboarding step offers, in the order it shows them. */
export const COUNTRIES = CURRENCIES.flatMap((currency) =>
  currency.countries.map((country) => ({ ...country, currency: currency.code }))
);

/** The currency implied by a country chosen at onboarding. */
export function currencyForCountry(countryCode: string): string {
  return COUNTRIES.find((c) => c.code === countryCode)?.currency ?? "USD";
}

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
