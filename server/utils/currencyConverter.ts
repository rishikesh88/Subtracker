// Rates live in exchangeRates.ts, which refreshes them from the European
// Central Bank and keeps a fallback for when that service is unreachable.
// This file is the arithmetic only.
import { ratesToInr } from '../lib/exchangeRates';

/**
 * Convert an amount from one currency to another at the current rate
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
  
  // Read the table once, so a refresh landing mid-calculation cannot convert
  // one side of the sum at yesterday's rate and the other at today's.
  const rates = ratesToInr();

  // An unknown currency converts as though it were rupees. That is wrong, but
  // it is the long-standing behaviour and changing it belongs with the work
  // that decides what an unrecognised currency should do on screen.
  const fromRate = rates[from] || rates['INR'];
  const toRate = rates[to] || rates['INR'];
  
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