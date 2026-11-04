-- Indeksene lages før fremmednøklene: de sammensatte nøklene trenger de unike indeksene
-- (organization_id, id) på orders og assignments. orders og assignments peker på hverandre.
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_ref" text,
	"ordered_by_text" text,
	"address_text" text NOT NULL,
	"requested_report_type" text DEFAULT 'condition_report' NOT NULL,
	"gnr" text,
	"bnr" text,
	"snr" text,
	"housing_association_name" text,
	"seller_declaration_received" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"rejected_reason" text,
	"assignment_id" uuid,
	CONSTRAINT "orders_source_check" CHECK ("orders"."source" in ('manual', 'email')),
	CONSTRAINT "orders_requested_report_type_check" CHECK ("orders"."requested_report_type" in ('condition_report')),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('received', 'converted', 'rejected')),
	CONSTRAINT "orders_rejected_reason_check" CHECK ("orders"."status" <> 'rejected' or length(trim(coalesce("orders"."rejected_reason", ''))) > 0),
	CONSTRAINT "orders_assignment_id_check" CHECK (("orders"."status" = 'converted') = ("orders"."assignment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"number" text NOT NULL,
	"office_id" uuid NOT NULL,
	"order_id" uuid,
	"assignment_type" text DEFAULT 'condition_report' NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	CONSTRAINT "assignments_assignment_type_check" CHECK ("assignments"."assignment_type" in ('condition_report')),
	CONSTRAINT "assignments_status_check" CHECK ("assignments"."status" in ('ordered', 'in_progress', 'completed', 'invoiced'))
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"prefix" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "number_sequences_scope_check" CHECK ("number_sequences"."scope" in ('assignment')),
	CONSTRAINT "number_sequences_next_value_check" CHECK ("number_sequences"."next_value" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_organization_id_id_idx" ON "orders" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE INDEX "orders_organization_id_received_at_idx" ON "orders" USING btree ("organization_id","received_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_organization_id_id_idx" ON "assignments" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_organization_id_number_idx" ON "assignments" USING btree ("organization_id","number");
--> statement-breakpoint
CREATE UNIQUE INDEX "number_sequences_organization_id_scope_prefix_idx" ON "number_sequences" USING btree ("organization_id","scope","prefix");
--> statement-breakpoint
CREATE INDEX "events_organization_id_assignment_id_idx" ON "events" USING btree ("organization_id","assignment_id");
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_office_fk" FOREIGN KEY ("organization_id","office_id") REFERENCES "public"."offices"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;
