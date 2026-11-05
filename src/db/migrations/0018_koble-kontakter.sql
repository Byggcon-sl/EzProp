-- Partene og bestilleren kobles til kontaktregisteret (valgfritt). De sammensatte
-- fremmednøklene bruker de unike indeksene (organization_id, id) på contacts og firms fra 0017.
ALTER TABLE "orders" ADD COLUMN "ordered_by_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ordered_by_firm_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ordered_by_contact_fk" FOREIGN KEY ("organization_id","ordered_by_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ordered_by_firm_fk" FOREIGN KEY ("organization_id","ordered_by_firm_id") REFERENCES "public"."firms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD CONSTRAINT "assignment_parties_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD CONSTRAINT "assignment_parties_firm_fk" FOREIGN KEY ("organization_id","firm_id") REFERENCES "public"."firms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_organization_id_ordered_by_contact_id_idx" ON "orders" USING btree ("organization_id","ordered_by_contact_id");--> statement-breakpoint
CREATE INDEX "assignment_parties_organization_id_contact_id_idx" ON "assignment_parties" USING btree ("organization_id","contact_id");