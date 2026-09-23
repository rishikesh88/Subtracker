CREATE TABLE "emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gmail_account_id" varchar,
	"email_provider" text,
	"provider_account_id" varchar,
	"gmail_id" text NOT NULL,
	"subject" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"received_at" timestamp NOT NULL,
	"content" text,
	"attachment_data" text,
	"is_transaction" boolean DEFAULT false,
	"extracted_amount" numeric(10, 2),
	"extracted_currency" text,
	"merchant_name" text,
	"subscription_id" varchar,
	"processed" boolean DEFAULT false,
	"analyzed_at" timestamp DEFAULT now(),
	CONSTRAINT "emails_gmail_id_unique" UNIQUE("gmail_id"),
	CONSTRAINT "valid_email_provider" CHECK (email_provider IS NULL OR email_provider IN ('gmail', 'outlook')),
	CONSTRAINT "provider_fields_sync" CHECK ((email_provider IS NULL) = (provider_account_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "gmail_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gmail_email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp,
	"last_sync" timestamp,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_url" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outlook_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"outlook_email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp,
	"tenant_id" text,
	"account_type" text DEFAULT 'personal' NOT NULL,
	"last_sync" timestamp,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "valid_account_type" CHECK (account_type IN ('personal', 'work_school'))
);
--> statement-breakpoint
CREATE TABLE "screened_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"message_id" text NOT NULL,
	"screened_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gmail_account_id" varchar,
	"email_provider" text,
	"provider_account_id" varchar,
	"service_name" text NOT NULL,
	"service_key" text NOT NULL,
	"merchant_name" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"frequency" text NOT NULL,
	"category" text,
	"confidence" text NOT NULL,
	"confidence_score" numeric(3, 2) NOT NULL,
	"reasoning" text,
	"evidence_email_ids" text[],
	"occurrences" integer DEFAULT 1 NOT NULL,
	"recurrence_type" text,
	"recurrence_score" integer DEFAULT 0,
	"recurring_keywords" text[],
	"sender_history" text,
	"attachment_evidence" text,
	"validation_checks" text,
	"next_billing_date" timestamp,
	"last_seen" timestamp NOT NULL,
	"detected_at" timestamp DEFAULT now(),
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "valid_email_provider" CHECK (email_provider IS NULL OR email_provider IN ('gmail', 'outlook')),
	CONSTRAINT "provider_fields_sync" CHECK ((email_provider IS NULL) = (provider_account_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gmail_account_id" varchar,
	"email_provider" text,
	"provider_account_id" varchar,
	"service_name" text NOT NULL,
	"service_key" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"frequency" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merchant_email" text,
	"merchant_name" text,
	"occurrences" integer DEFAULT 1,
	"next_billing_date" timestamp,
	"last_email_date" timestamp,
	"detected_at" timestamp DEFAULT now(),
	"owner_name" text,
	"owner_email" text,
	"description" text,
	CONSTRAINT "valid_email_provider" CHECK (email_provider IS NULL OR email_provider IN ('gmail', 'outlook')),
	CONSTRAINT "provider_fields_sync" CHECK ((email_provider IS NULL) = (provider_account_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger_source" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"error" text,
	"emails_processed" integer DEFAULT 0,
	"suggestions_generated" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"gmail_access_token" text,
	"gmail_refresh_token" text,
	"gmail_token_expiry" timestamp,
	"gmail_connected" boolean DEFAULT false,
	"gmail_email" text,
	"last_sync" timestamp,
	"preferred_currency" text DEFAULT 'INR' NOT NULL,
	"email_sync_days" integer DEFAULT 90 NOT NULL,
	"password_hash" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verification_token" text,
	"email_verification_expiry" timestamp,
	"organization_name" text,
	"country_code" text,
	"account_holder_name" text,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"privacy_consent_given" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_emails_user_provider" ON "emails" USING btree ("user_id","email_provider");--> statement-breakpoint
CREATE INDEX "idx_emails_provider_account" ON "emails" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_gmail_accounts_user_id" ON "gmail_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_gmail_accounts_user_email" ON "gmail_accounts" USING btree ("user_id","gmail_email");--> statement-breakpoint
CREATE INDEX "idx_outlook_accounts_user_id" ON "outlook_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_outlook_accounts_user_email" ON "outlook_accounts" USING btree ("user_id","outlook_email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_screened_user_provider_message" ON "screened_messages" USING btree ("user_id","provider","message_id");--> statement-breakpoint
CREATE INDEX "idx_screened_user_provider" ON "screened_messages" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_suggestions_user_provider" ON "subscription_suggestions" USING btree ("user_id","email_provider");--> statement-breakpoint
CREATE INDEX "idx_suggestions_provider_account" ON "subscription_suggestions" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_provider" ON "subscriptions" USING btree ("user_id","email_provider");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_provider_account" ON "subscriptions" USING btree ("provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_jobs_one_running_per_user" ON "sync_jobs" USING btree ("user_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "idx_sync_jobs_user_started" ON "sync_jobs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_user_id" ON "verification_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_code" ON "verification_codes" USING btree ("code");