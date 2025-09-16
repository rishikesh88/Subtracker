/**
 * Generate a unique service key for subscription deduplication
 * Format: normalizedServiceName_frequency
 */
export function generateServiceKey(serviceName: string, merchantName?: string, frequency: string = 'monthly'): string {
  // Use merchant name if available, otherwise service name
  const name = merchantName || serviceName;
  
  // Conservative normalization for deduplication
  // Only normalize for known telecom providers to avoid over-merging
  const knownTelecomProviders = ['airtel', 'jio', 'vodafone', 'bsnl', 'tata', 'idea'];
  const baseName = name.toLowerCase().trim();
  
  let normalized = baseName;
  
  // Only remove plan types for known telecom providers
  const isTelecom = knownTelecomProviders.some(provider => baseName.includes(provider));
  if (isTelecom) {
    normalized = normalized
      .replace(/\b(black|red|blue|gold|silver|premium|plus|pro|basic|standard|postpaid|prepaid)\b/g, '') // Remove telecom plan types
      .replace(/\b(telecom|communications?|services?|limited|ltd|inc|corp)\b/g, ''); // Remove business terms
  }
  
  // Safe normalization for all services
  normalized = normalized
    .replace(/[^a-zA-Z0-9]/g, '_') // Replace special chars with underscore
    .replace(/_+/g, '_') // Multiple underscores to single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  
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