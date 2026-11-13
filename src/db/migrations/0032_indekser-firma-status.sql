CREATE INDEX "orders_organization_id_ordered_by_firm_id_idx" ON "orders" USING btree ("organization_id","ordered_by_firm_id");--> statement-breakpoint
CREATE INDEX "assignments_organization_id_status_idx" ON "assignments" USING btree ("organization_id","status") WHERE "assignments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assignment_parties_organization_id_firm_id_idx" ON "assignment_parties" USING btree ("organization_id","firm_id");--> statement-breakpoint
CREATE INDEX "contacts_organization_id_firm_id_idx" ON "contacts" USING btree ("organization_id","firm_id");