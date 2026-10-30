DROP INDEX "trial_answers_organization_id_idx";--> statement-breakpoint
DROP INDEX "trial_forms_organization_id_idx";--> statement-breakpoint
DROP INDEX "trial_photos_organization_id_idx";--> statement-breakpoint
CREATE INDEX "trial_answers_organization_id_updated_at_id_idx" ON "trial_answers" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "trial_forms_organization_id_updated_at_id_idx" ON "trial_forms" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "trial_photos_organization_id_updated_at_id_idx" ON "trial_photos" USING btree ("organization_id","updated_at","id");