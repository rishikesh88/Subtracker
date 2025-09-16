/**
 * Recurrence Analysis Service
 * Analyzes email patterns to detect recurring billing cycles
 */

import { Email } from "@shared/schema";

export interface RecurrenceAnalysis {
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  confidence: number; // 0-100
  intervalDays: number;
  nextPredictedDate: Date | null;
  consistency: number; // 0-100, amount consistency
}

export interface EmailCluster {
  merchantName: string;
  normalizedMerchant: string;
  emails: Email[];
  amounts: number[];
  dates: Date[];
  avgAmount: number;
  amountVariance: number;
}

export class RecurrenceAnalyzer {
  
  /**
   * Normalize merchant name for clustering
   */
  private normalizeMerchant(email: Email): string {
    const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase() || '';
    const merchantName = email.merchantName?.toLowerCase() || '';
    const fromName = email.fromName?.toLowerCase() || '';
    
    // Extract key merchant identifiers
    const domain = fromDomain.replace(/^(mail\.|noreply\.|no-reply\.|notification\.)/, '');
    const cleanDomain = domain.replace(/\.(com|in|org|net|co\.in)$/, '');
    
    // Use the most specific identifier available
    if (merchantName.length > 2) return merchantName;
    if (fromName.length > 2 && !fromName.includes('noreply')) return fromName;
    return cleanDomain;
  }

  /**
   * Cluster emails by merchant for recurrence analysis
   */
  clusterEmailsByMerchant(emails: Email[]): EmailCluster[] {
    const clusters = new Map<string, EmailCluster>();
    
    for (const email of emails) {
      if (!email.extractedAmount || !email.receivedAt) continue;
      
      const normalizedMerchant = this.normalizeMerchant(email);
      if (!normalizedMerchant || normalizedMerchant.length < 2) continue;
      
      const amount = parseFloat(email.extractedAmount);
      if (isNaN(amount) || amount <= 0) continue;
      
      if (!clusters.has(normalizedMerchant)) {
        clusters.set(normalizedMerchant, {
          merchantName: email.merchantName || email.fromName || normalizedMerchant,
          normalizedMerchant,
          emails: [],
          amounts: [],
          dates: [],
          avgAmount: 0,
          amountVariance: 0
        });
      }
      
      const cluster = clusters.get(normalizedMerchant)!;
      cluster.emails.push(email);
      cluster.amounts.push(amount);
      cluster.dates.push(new Date(email.receivedAt));
    }
    
    // Calculate stats for each cluster
    for (const cluster of clusters.values()) {
      cluster.dates.sort((a, b) => a.getTime() - b.getTime());
      cluster.avgAmount = cluster.amounts.reduce((sum, amt) => sum + amt, 0) / cluster.amounts.length;
      
      // Calculate amount variance
      const variance = cluster.amounts.reduce((sum, amt) => sum + Math.pow(amt - cluster.avgAmount, 2), 0) / cluster.amounts.length;
      cluster.amountVariance = Math.sqrt(variance) / cluster.avgAmount * 100; // CV as percentage
    }
    
    return Array.from(clusters.values());
  }

  /**
   * Analyze recurrence pattern for a cluster of emails
   */
  analyzeRecurrence(cluster: EmailCluster): RecurrenceAnalysis {
    if (cluster.dates.length < 2) {
      return {
        frequency: null,
        confidence: 0,
        intervalDays: 0,
        nextPredictedDate: null,
        consistency: 0
      };
    }
    
    // Calculate intervals between consecutive emails
    const intervals: number[] = [];
    for (let i = 1; i < cluster.dates.length; i++) {
      const diffMs = cluster.dates[i].getTime() - cluster.dates[i-1].getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      intervals.push(diffDays);
    }
    
    if (intervals.length === 0) {
      return {
        frequency: null,
        confidence: 0,
        intervalDays: 0,
        nextPredictedDate: null,
        consistency: 0
      };
    }
    
    // Calculate average interval
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    
    // Calculate interval consistency (lower variance = higher consistency)
    const intervalVariance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    const intervalStdDev = Math.sqrt(intervalVariance);
    
    // Determine frequency type based on average interval
    let frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null = null;
    let frequencyConfidence = 0;
    
    if (avgInterval >= 5 && avgInterval <= 9) { // Weekly (7 ± 2 days)
      frequency = 'weekly';
      frequencyConfidence = Math.max(0, 100 - Math.abs(avgInterval - 7) * 25);
    } else if (avgInterval >= 25 && avgInterval <= 35) { // Monthly (30 ± 5 days)
      frequency = 'monthly';
      frequencyConfidence = Math.max(0, 100 - Math.abs(avgInterval - 30) * 10);
    } else if (avgInterval >= 85 && avgInterval <= 95) { // Quarterly (~90 days)
      frequency = 'quarterly';
      frequencyConfidence = Math.max(0, 100 - Math.abs(avgInterval - 90) * 5);
    } else if (avgInterval >= 350 && avgInterval <= 380) { // Yearly (365 ± 15 days)
      frequency = 'yearly';
      frequencyConfidence = Math.max(0, 100 - Math.abs(avgInterval - 365) * 2);
    }
    
    // Calculate consistency score
    const consistencyScore = Math.max(0, 100 - (intervalStdDev / avgInterval * 100));
    
    // Calculate amount consistency
    const amountConsistency = Math.max(0, 100 - cluster.amountVariance);
    
    // Overall confidence factors
    let confidence = 0;
    if (frequency && cluster.dates.length >= 3) { // Need at least 3 occurrences
      confidence = (frequencyConfidence * 0.4) + (consistencyScore * 0.3) + (amountConsistency * 0.2);
      
      // Bonus for more occurrences
      if (cluster.dates.length >= 5) confidence += 10;
      if (cluster.dates.length >= 10) confidence += 10;
      
      confidence = Math.min(100, confidence);
    }
    
    // Predict next billing date
    let nextPredictedDate: Date | null = null;
    if (frequency && confidence > 30) {
      const lastDate = cluster.dates[cluster.dates.length - 1];
      nextPredictedDate = new Date(lastDate.getTime() + (avgInterval * 24 * 60 * 60 * 1000));
    }
    
    return {
      frequency,
      confidence: Math.round(confidence),
      intervalDays: Math.round(avgInterval),
      nextPredictedDate,
      consistency: Math.round(amountConsistency)
    };
  }

  /**
   * Analyze all email clusters for recurring patterns
   */
  analyzeAllClusters(emails: Email[]): Array<EmailCluster & { recurrence: RecurrenceAnalysis }> {
    const clusters = this.clusterEmailsByMerchant(emails);
    
    return clusters
      .map(cluster => ({
        ...cluster,
        recurrence: this.analyzeRecurrence(cluster)
      }))
      .filter(cluster => 
        cluster.emails.length >= 2 && // At least 2 emails
        cluster.recurrence.confidence >= 20 // Minimum confidence threshold
      )
      .sort((a, b) => b.recurrence.confidence - a.recurrence.confidence); // Sort by confidence
  }
}

export const recurrenceAnalyzer = new RecurrenceAnalyzer();