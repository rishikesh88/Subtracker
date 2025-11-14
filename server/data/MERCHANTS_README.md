# 🔒 MERCHANT DATABASE PROTECTION

## File: merchants.csv

**Protection Level:** APPEND-ONLY  
**Current Entries:** 201 verified merchants  
**Version:** 1.1.1  
**Last Modified:** 2025-11-14

---

## MODIFICATION RULES

### ✅ ALLOWED OPERATIONS

**Adding New Merchants:**
1. Add new entry to end of file
2. Maintain CSV format exactly:
   ```
   name,websiteDomain,billingEmailDomain,products,frequency,regions
   ```
3. Notify user: "Added new merchant: [Name]"
4. Update merchant count in this file
5. Update SPECIFICATION.md merchant count

### ❌ PROHIBITED OPERATIONS

- Modifying existing merchant entries
- Removing merchant entries
- Changing CSV header row
- Reordering entries
- Changing file format/structure

---

## ADDING MERCHANTS - PROTOCOL

### Step 1: Verify Merchant

Ensure the merchant is:
- A legitimate subscription/SaaS service
- Has recurring billing (not one-time purchases)
- Commonly used service worth detecting

### Step 2: Add Entry

Format:
```csv
Merchant Name,website.com,billing@website.com,Product Name,monthly/annual,Region
```

Example:
```csv
Zoom,zoom.us,no-reply@zoom.us,Zoom Pro,monthly,Global
```

### Step 3: Notify User

Template:
```
ℹ️ MERCHANT DATABASE UPDATE

Added new merchant to database:
- Name: [Merchant Name]
- Domain: [website.com]
- Products: [Product Name]

Total merchants: [new count]
Previous: [old count]

This merchant will now receive +80 point bonus during transaction detection.
```

### Step 4: Update Documentation

- Increment merchant count in this README
- Update `server/core/SPECIFICATION.md` merchant count
- Update `server/core/README.md` if significant change

---

## DATA FORMAT

### CSV Structure

```
Column 1: Merchant Name (display name)
Column 2: Website Domain (primary domain, no www)
Column 3: Billing Email Domain (sender email or pattern)
Column 4: Products (services offered)
Column 5: Frequency (monthly, annual, quarterly)
Column 6: Regions (Global, US, EU, etc.)
```

### Special Patterns

**Email Patterns with Wildcards:**
```csv
Stripe,stripe.com,receipts+{account}@stripe.com,Stripe Payments,monthly,Global
```

The `{account}` placeholder matches any account-specific emails.

---

## LOOKUP PERFORMANCE

**Complexity:**
- Domain lookup: O(1) - Hash map
- Email domain lookup: O(1) - Hash map
- Pattern matching: O(n) - Regex (rare fallback)

**Optimization:**
- Merchant database is lazy-loaded on first use
- Lookups are cached in memory
- No database queries required

---

## IMPACT ON DETECTION

**Merchant Database Bonus:** +80 points (strongest signal)

When an email sender matches a merchant in this database:
- Immediately scores 80 points
- Skips other sender checks (early return)
- High confidence candidate
- Prioritized for AI analysis

**ROI:** High - Reduces false positives significantly by verifying known subscription services.

---

## VERSION HISTORY

| Version | Date | Entries | Changes |
|---------|------|---------|---------|
| 1.1.1 | 2025-11-14 | 201 | Fixed Airtel billing email: billing@airtel.in → ebill@airtel.com (verified from user's actual email) |
| 1.1.0 | 2025-11-12 | 201 | Added 50 telecom providers (US, UK, EU, India) |
| 1.0.0 | 2025-11-10 | 151 | Initial protection setup |

---

## MERCHANT DATABASE STATISTICS

**Current Coverage:**
- Payment Processors: ~10
- Subscription Platforms: ~7
- SaaS Services: ~80
- Hosting/Infrastructure: ~15
- Marketing/Analytics: ~25
- Productivity Tools: ~15
- Telecom/ISP Providers: 50

**Geographic Coverage:**
- Global: ~130 merchants
- US-specific: ~25 merchants
- UK-specific: ~10 merchants
- EU-specific: ~25 merchants
- India-specific: ~10 merchants
- Region-agnostic: ~1 merchant

---

**Last Updated:** 2025-11-14  
**Protection Status:** 🔒 ACTIVE APPEND-ONLY  
**Maintained By:** User (with AI assistance for additions)
