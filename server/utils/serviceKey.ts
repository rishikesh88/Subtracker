/**
 * Generate a unique service key for subscription deduplication
 * Format: normalizedServiceName_frequency
 */
export function generateServiceKey(serviceName: string, merchantName?: string, frequency: string = 'monthly'): string {
  // Use merchant name if available, otherwise service name
  const name = merchantName || serviceName;
  
  // Normalize the name by removing special characters, spaces, and converting to lowercase
  const normalized = name
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  // Normalize frequency
  const normalizedFrequency = frequency.toLowerCase().trim();
  
  return `${normalized}_${normalizedFrequency}`;
}

/**
 * Check if two amounts are similar within tolerance (±5%)
 */
export function amountsAreSimilar(amount1: string, amount2: string, tolerance: number = 0.05): boolean {
  const num1 = parseFloat(amount1);
  const num2 = parseFloat(amount2);
  
  if (isNaN(num1) || isNaN(num2)) return false;
  
  const diff = Math.abs(num1 - num2);
  const maxAmount = Math.max(num1, num2);
  
  return diff <= (maxAmount * tolerance);
}