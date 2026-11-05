ALTER TABLE "assignments" ADD COLUMN "inspection_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "internal_note" text;