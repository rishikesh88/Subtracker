/**
 * Normalize service names and keys for consistent deduplication
 * Handles variations in AI output (casing, spacing, special characters)
 */

export function normalizeServiceKey(serviceName: string, frequency: string): string {
  // Normalize service name: lowercase, remove special chars, collapse whitespace
  const normalized = serviceName
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace whitespace with underscores
    .trim();
  
  // Normalize frequency
  const normalizedFrequency = frequency.toLowerCase().trim();
  
  return `${normalized}_${normalizedFrequency}`;
}

/**
 * Normalize merchant name for better matching
 */
export function normalizeMerchantName(merchantName: string): string {
  return merchantName
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Create a robust composite key using both service and merchant
 * This provides better deduplication resilience
 */
export function createRobustServiceKey(serviceName: string, merchantName: string, frequency: string): string {
  const normalizedService = serviceName
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  
  const normalizedMerchant = merchantName
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  
  const normalizedFrequency = frequency.toLowerCase().trim();
  
  // Use merchant as primary key component with service as secondary
  // This handles cases where AI varies service name but keeps merchant consistent
  return `${normalizedMerchant}_${normalizedService}_${normalizedFrequency}`;
}
