import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { users, gmailAccounts, emails, subscriptions, subscriptionSuggestions } from '@shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

async function migrateGmailAccounts() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  console.log('🔄 Starting Gmail accounts migration...');

  try {
    const usersWithGmail = await db
      .select()
      .from(users)
      .where(and(
        eq(users.gmailConnected, true),
        isNotNull(users.gmailEmail)
      ));

    console.log(`📊 Found ${usersWithGmail.length} users with Gmail connected`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of usersWithGmail) {
      console.log(`\n👤 Processing user: ${user.email} (${user.id})`);
      
      if (!user.gmailEmail || !user.gmailAccessToken || !user.gmailRefreshToken) {
        console.log(`  ⚠️  Skipping - missing Gmail credentials`);
        skippedCount++;
        continue;
      }

      const existingAccount = await db
        .select()
        .from(gmailAccounts)
        .where(and(
          eq(gmailAccounts.userId, user.id),
          eq(gmailAccounts.gmailEmail, user.gmailEmail)
        ))
        .limit(1);

      if (existingAccount.length > 0) {
        console.log(`  ℹ️  Gmail account already exists: ${user.gmailEmail}`);
        const accountId = existingAccount[0].id;
        
        const [emailCount, subCount, suggCount] = await Promise.all([
          db.select().from(emails).where(and(
            eq(emails.userId, user.id),
            eq(emails.gmailAccountId, accountId)
          )),
          db.select().from(subscriptions).where(and(
            eq(subscriptions.userId, user.id),
            eq(subscriptions.gmailAccountId, accountId)
          )),
          db.select().from(subscriptionSuggestions).where(and(
            eq(subscriptionSuggestions.userId, user.id),
            eq(subscriptionSuggestions.gmailAccountId, accountId)
          ))
        ]);

        console.log(`  📧 Already linked: ${emailCount.length} emails, ${subCount.length} subscriptions, ${suggCount.length} suggestions`);
        skippedCount++;
        continue;
      }

      console.log(`  ✨ Creating new Gmail account record for: ${user.gmailEmail}`);
      const [newAccount] = await db.insert(gmailAccounts).values({
        userId: user.id,
        gmailEmail: user.gmailEmail,
        accessToken: user.gmailAccessToken,
        refreshToken: user.gmailRefreshToken,
        tokenExpiry: user.gmailTokenExpiry,
        lastSync: user.lastSync,
        syncStatus: 'idle',
      }).returning();

      console.log(`  📝 Created account ID: ${newAccount.id}`);

      const [emailsUpdated, subscriptionsUpdated, suggestionsUpdated] = await Promise.all([
        db.update(emails)
          .set({ gmailAccountId: newAccount.id })
          .where(eq(emails.userId, user.id))
          .returning(),
        db.update(subscriptions)
          .set({ gmailAccountId: newAccount.id })
          .where(eq(subscriptions.userId, user.id))
          .returning(),
        db.update(subscriptionSuggestions)
          .set({ gmailAccountId: newAccount.id })
          .where(eq(subscriptionSuggestions.userId, user.id))
          .returning()
      ]);

      console.log(`  📧 Updated ${emailsUpdated.length} emails`);
      console.log(`  📮 Updated ${subscriptionsUpdated.length} subscriptions`);
      console.log(`  💡 Updated ${suggestionsUpdated.length} suggestions`);
      
      migratedCount++;
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   ✓ Migrated: ${migratedCount} users`);
    console.log(`   ⊘ Skipped: ${skippedCount} users`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

migrateGmailAccounts()
  .then(() => {
    console.log('\n🎉 Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
