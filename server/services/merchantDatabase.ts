import { readFileSync } from 'fs';
import { join } from 'path';

export interface Merchant {
  name: string;
  websiteDomain: string;
  billingEmailDomain: string;
  products: string;
  frequency: string;
  regions: string;
}

export class MerchantDatabase {
  private merchants: Merchant[] = [];
  private domainMap: Map<string, Merchant> = new Map();
  private emailDomainMap: Map<string, Merchant> = new Map();
  private emailPatternMap: Map<string, Merchant> = new Map();

  constructor() {
    this.loadMerchants();
  }

  private loadMerchants() {
    try {
      const csvPath = join(import.meta.dirname, '../data/merchants.csv');
      const csvContent = readFileSync(csvPath, 'utf-8');
      
      const lines = csvContent.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Parse CSV with proper handling of commas in quotes
        const fields = this.parseCSVLine(line);
        if (fields.length < 6) continue;
        
        const merchant: Merchant = {
          name: fields[0].trim(),
          websiteDomain: fields[1].trim().toLowerCase(),
          billingEmailDomain: fields[2].trim().toLowerCase(),
          products: fields[3].trim(),
          frequency: fields[4].trim(),
          regions: fields[5].trim()
        };
        
        this.merchants.push(merchant);
        
        // Create lookups
        // Website domain lookup: stripe.com → Stripe
        if (merchant.websiteDomain) {
          this.domainMap.set(merchant.websiteDomain, merchant);
          // Also add without www
          const withoutWww = merchant.websiteDomain.replace(/^www\./, '');
          this.domainMap.set(withoutWww, merchant);
        }
        
        // Email domain lookup: billing@stripe.com → Stripe
        if (merchant.billingEmailDomain) {
          const emailDomain = this.extractDomain(merchant.billingEmailDomain);
          if (emailDomain) {
            this.emailDomainMap.set(emailDomain, merchant);
          }
          
          // Handle special patterns like receipts+{account}@stripe.com
          if (merchant.billingEmailDomain.includes('{')) {
            const pattern = merchant.billingEmailDomain.replace(/\{[^}]+\}/g, '*');
            this.emailPatternMap.set(pattern, merchant);
          }
        }
      }
      
      console.log(`✅ Loaded ${this.merchants.length} known merchants into database`);
      console.log(`📊 Domain lookups: ${this.domainMap.size}, Email lookups: ${this.emailDomainMap.size}`);
      
    } catch (error) {
      console.error('⚠️  Failed to load merchant database:', error);
      // Non-fatal: system continues without merchant database
    }
  }

  private parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    
    return fields;
  }

  private extractDomain(email: string): string | null {
    // Extract domain from email: billing@stripe.com → stripe.com
    const match = email.match(/@([a-zA-Z0-9.-]+)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Check if an email sender is from a known merchant
   * @param senderEmail Full email address (e.g., "billing@stripe.com")
   * @returns Merchant object if found, null otherwise
   */
  public isKnownMerchant(senderEmail: string): Merchant | null {
    if (!senderEmail) return null;
    
    const normalizedEmail = senderEmail.toLowerCase().trim();
    
    // 1. Exact email match
    for (const merchant of this.merchants) {
      if (normalizedEmail === merchant.billingEmailDomain.toLowerCase()) {
        return merchant;
      }
    }
    
    // 2. Domain-based lookup
    const domain = this.extractDomain(normalizedEmail);
    if (domain) {
      // Check if email domain matches any merchant
      const merchantByEmailDomain = this.emailDomainMap.get(domain);
      if (merchantByEmailDomain) {
        return merchantByEmailDomain;
      }
      
      // Check if domain matches website domain
      const merchantByWebDomain = this.domainMap.get(domain);
      if (merchantByWebDomain) {
        return merchantByWebDomain;
      }
    }
    
    // 3. Pattern matching (e.g., receipts+xxx@stripe.com)
    const patterns = Array.from(this.emailPatternMap.entries());
    for (const [pattern, merchant] of patterns) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
      if (regex.test(normalizedEmail)) {
        return merchant;
      }
    }
    
    return null;
  }

  /**
   * Check if a domain belongs to a known merchant
   * @param domain Domain name (e.g., "stripe.com")
   * @returns Merchant object if found, null otherwise
   */
  public getMerchantByDomain(domain: string): Merchant | null {
    if (!domain) return null;
    
    const normalizedDomain = domain.toLowerCase().trim();
    return this.domainMap.get(normalizedDomain) || null;
  }

  /**
   * Get merchant name from email (for display purposes)
   */
  public getMerchantName(senderEmail: string): string | null {
    const merchant = this.isKnownMerchant(senderEmail);
    return merchant ? merchant.name : null;
  }

  /**
   * Get all known merchant domains (for Gmail query building)
   */
  public getAllBillingEmailDomains(): string[] {
    return this.merchants
      .map(m => m.billingEmailDomain)
      .filter(email => email && !email.includes('{')) // Skip pattern emails
      .slice(0, 100); // Gmail query has size limits, take top 100
  }

  /**
   * Get total count of known merchants
   */
  public getCount(): number {
    return this.merchants.length;
  }
}

// Singleton instance
let merchantDB: MerchantDatabase | null = null;

export function getMerchantDatabase(): MerchantDatabase {
  if (!merchantDB) {
    merchantDB = new MerchantDatabase();
  }
  return merchantDB;
}
