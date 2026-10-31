CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_kind_check" CHECK ("login_attempts"."kind" in ('code_requested', 'code_failed', 'login_succeeded'))
);
--> statement-breakpoint
CREATE INDEX "login_attempts_email_hash_kind_created_at_idx" ON "login_attempts" USING btree ("email_hash","kind","created_at");