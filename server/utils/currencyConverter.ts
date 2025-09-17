// Static exchange rates for currency conversion
// Base rates to INR (Indian Rupees)
const EXCHANGE_RATES: Record<string, number> = {
  'INR': 1.0,       // Base currency
  'USD': 83.0,      // 1 USD = 83 INR
  'EUR': 90.0,      // 1 EUR = 90 INR  
  'GBP': 105.0,     // 1 GBP = 105 INR
};

/**
 * Convert an amount from one currency to another using static exchange rates
 * @param amount - The amount to convert
 * @param fromCurrency - Source currency code (e.g., 'USD')
 * @param toCurrency - Target currency code (e.g., 'INR') 
 * @returns Converted amount
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string = 'INR'
): number {
  // Handle invalid inputs
  if (!amount || amount < 0) return 0;
  
  // Normalize currency codes
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  
  // Same currency, no conversion needed
  if (from === to) return amount;
  
  // Get exchange rates, fallback to INR rate if currency not found
  const fromRate = EXCHANGE_RATES[from] || EXCHANGE_RATES['INR'];
  const toRate = EXCHANGE_RATES[to] || EXCHANGE_RATES['INR'];
  
  // Convert: amount -> INR -> target currency
  const inrAmount = from === 'INR' ? amount : amount * fromRate;
  const convertedAmount = to === 'INR' ? inrAmount : inrAmount / toRate;
  
  return Math.round(convertedAmount * 100) / 100; // Round to 2 decimal places
}

/**
 * Convert an array of subscription amounts to a target currency
 * @param subscriptions - Array of subscription objects with amount and currency
 * @param toCurrency - Target currency code
 * @returns Array with converted amounts
 */
export function convertSubscriptions(
  subscriptions: Array<{ amount: string; currency: string; [key: string]: any }>,
  toCurrency: string = 'INR'
) {
  return subscriptions.map(subscription => {
    const originalAmount = parseFloat(subscription.amount);
    const convertedAmount = convertCurrency(originalAmount, subscription.currency, toCurrency);
    
    return {
      ...subscription,
      convertedAmount,
      displayCurrency: toCurrency
    };
  });
}

/**
 * Get list of supported currencies
 */
export function getSupportedCurrencies(): Array<{code: string, name: string, symbol: string}> {
  return [
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' }
  ];
}