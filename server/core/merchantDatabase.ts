/**
 * 🔒 PROTECTED CORE LOGIC - MODIFICATION REQUIRES USER APPROVAL
 * 
 * Merchant Database Service
 * Verified merchant lookup for enhanced transaction detection
 * 
 * @version 1.0.1
 * @lastModified 2026-08-18
 * @protection LOCKED - See server/core/README.md for modification protocol
 * @dataSource server/data/merchants.csv (APPEND-ONLY)
 * 
 * CRITICAL: This file contains merchant lookup logic and database loading.
 * Modifications to lookup algorithms or data structures require user approval.
 * See SPECIFICATION.md for canonical implementation.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDomain } from 'tldts';

export interface Merchant {
  name: string;
  websiteDomain: string;
  websiteDomains: string[]; // Multiple domains for the merchant
  billingEmailDomain: string;
  products: string;
  frequency: string;
  regions: string;
}

export interface MerchantMatch {
  merchant: Merchant;
  matchType: 'exact_email' | 'root_domain' | 'pattern';
  score: number; // 80 for exact, 60 for domain, 45 for pattern
}

export class MerchantDatabase {
  private merchants: Merchant[] = [];
  private domainMap: Map<string, Merchant> = new Map();
  private emailDomainMap: Map<string, Merchant> = new Map();
  private emailPatternMap: Map<string, Merchant> = new Map();
  private rootDomainMap: Map<string, Merchant> = new Map(); // Root domain index (airtel.com/in → Airtel)

  constructor() {
    this.loadMerchants();
  }

  /**
   * Resolve merchants.csv across the layouts this file runs under.
   *
   * Under tsx (development) import.meta.dirname is server/core, so '../data'
   * resolves correctly. After esbuild bundles the server into dist/index.js it
   * becomes dist/, and '../data' points at a directory that does not exist --
   * which silently disabled merchant enrichment in every production build.
   * Candidates are ordered most- to least-specific; the first that exists wins.
   */
  private resolveCsvPath(): string | null {
    const candidates = [
      join(import.meta.dirname, '../data/merchants.csv'), // tsx: server/core -> server/data
      join(import.meta.dirname, 'data/merchants.csv'),    // bundled alongside dist/
      join(process.cwd(), 'server/data/merchants.csv'),   // bundled, repo present at cwd
      join(process.cwd(), 'data/merchants.csv'),          // data copied to deploy root
    ];

    return candidates.find(existsSync) ?? null;
  }

  private loadMerchants() {
    try {
      const csvPath = this.resolveCsvPath();
      if (!csvPath) {
        throw new Error(
          'merchants.csv not found. Merchant enrichment is disabled. ' +
            `Searched relative to ${import.meta.dirname} and ${process.cwd()}.`
        );
      }
      console.log(`[MerchantDatabase] Loading merchants from ${csvPath}`);
      const csvContent = readFileSync(csvPath, 'utf-8');
      
      const lines = csvContent.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Parse CSV with proper handling of commas in quotes
        const fields = this.parseCSVLine(line);
        if (fields.length < 6) continue;
        
        const rawDomain = fields[1].trim().toLowerCase();
        
        // Parse pipe-separated domains: airtel.com|airtel.in → ['airtel.com', 'airtel.in']
        const websiteDomains = rawDomain.split('|').map(d => d.trim()).filter(d => d);
        
        const merchant: Merchant = {
          name: fields[0].trim(),
          websiteDomain: websiteDomains[0] || rawDomain, // Primary domain
          websiteDomains: websiteDomains,
          billingEmailDomain: fields[2].trim().toLowerCase(),
          products: fields[3].trim(),
          frequency: fields[4].trim(),
          regions: fields[5].trim()
        };
        
        this.merchants.push(merchant);
        
        // Create lookups for all website domains
        for (const domain of merchant.websiteDomains) {
          if (!domain) continue;
          
          // Exact domain lookup: stripe.com → Stripe
          this.domainMap.set(domain, merchant);
          
          // Without www: www.stripe.com → stripe.com
          const withoutWww = domain.replace(/^www\./, '');
          if (withoutWww !== domain) {
            this.domainMap.set(withoutWww, merchant);
          }
          
          // Root domain index: airtel.com → Airtel, airtel.in → Airtel
          const rootDomain = this.extractRootDomain(domain);
          if (rootDomain) {
            this.rootDomainMap.set(rootDomain, merchant);
          }
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

  private extractRootDomain(domain: string): string | null {
    // Extract root domain using public suffix list to handle multi-level TLDs correctly
    // Examples:
    //   - bill.airtel.com → airtel.com ✓
    //   - vodafone.co.uk → vodafone.co.uk ✓ (not co.uk!)
    //   - subdomain.example.com.au → example.com.au ✓
    if (!domain) return null;
    
    try {
      // getDomain extracts the registered domain (eTLD+1)
      const rootDomain = getDomain(domain);
      return rootDomain ? rootDomain.toLowerCase() : domain.toLowerCase();
    } catch (error) {
      // Fallback: if tldts fails, return the original domain
      console.warn(`Failed to extract root domain for ${domain}, using original`, error);
      return domain.toLowerCase();
    }
  }

  /**
   * Check if an email sender is from a known merchant with tiered scoring
   * @param senderEmail Full email address (e.g., "billing@stripe.com")
   * @returns Merchant match with score, or null if not found
   */
  public isKnownMerchantWithScore(senderEmail: string): MerchantMatch | null {
    if (!senderEmail) return null;
    
    const normalizedEmail = senderEmail.toLowerCase().trim();
    
    // TIER 1: Exact email match (+80 points - highest confidence)
    for (const merchant of this.merchants) {
      if (normalizedEmail === merchant.billingEmailDomain.toLowerCase()) {
        return { 
          merchant, 
          matchType: 'exact_email',
          score: 80 
        };
      }
    }
    
    // TIER 2: Root domain match (+60 points - good confidence)
    const domain = this.extractDomain(normalizedEmail);
    if (domain) {
      const rootDomain = this.extractRootDomain(domain);
      if (rootDomain) {
        const merchantByRootDomain = this.rootDomainMap.get(rootDomain);
        if (merchantByRootDomain) {
          return {
            merchant: merchantByRootDomain,
            matchType: 'root_domain',
            score: 60
          };
        }
      }
      
      // Also check email domain map (for backward compatibility)
      const merchantByEmailDomain = this.emailDomainMap.get(domain);
      if (merchantByEmailDomain) {
        return {
          merchant: merchantByEmailDomain,
          matchType: 'root_domain',
          score: 60
        };
      }
      
      // Check if domain matches website domain
      const merchantByWebDomain = this.domainMap.get(domain);
      if (merchantByWebDomain) {
        return {
          merchant: merchantByWebDomain,
          matchType: 'root_domain',
          score: 60
        };
      }
    }
    
    // TIER 3: Pattern matching (+45 points - moderate confidence)
    const patterns = Array.from(this.emailPatternMap.entries());
    for (const [pattern, merchant] of patterns) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
      if (regex.test(normalizedEmail)) {
        return {
          merchant,
          matchType: 'pattern',
          score: 45
        };
      }
    }
    
    return null;
  }

  /**
   * Check if an email sender is from a known merchant (legacy method)
   * @param senderEmail Full email address (e.g., "billing@stripe.com")
   * @returns Merchant object if found, null otherwise
   * @deprecated Use isKnownMerchantWithScore for tiered scoring
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
