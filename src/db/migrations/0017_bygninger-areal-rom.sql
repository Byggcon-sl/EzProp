CREATE TABLE "report_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"assignment_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"report_building_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"below_ground" boolean DEFAULT false NOT NULL,
	CONSTRAINT "floors_level_check" CHECK ("floors"."level" between -3 and 20)
);
--> statement-breakpoint
CREATE TABLE "floor_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"floor_id" uuid NOT NULL,
	"bra_i" numeric(7, 1),
	"bra_e" numeric(7, 1),
	"bra_b" numeric(7, 1),
	"alh" numeric(7, 1),
	"measured_by" uuid,
	"method" text,
	"comment" text,
	CONSTRAINT "floor_areas_bra_i_check" CHECK ("floor_areas"."bra_i" >= 0),
	CONSTRAINT "floor_areas_bra_e_check" CHECK ("floor_areas"."bra_e" >= 0),
	CONSTRAINT "floor_areas_bra_b_check" CHECK ("floor_areas"."bra_b" >= 0),
	CONSTRAINT "floor_areas_alh_check" CHECK ("floor_areas"."alh" >= 0),
	CONSTRAINT "floor_areas_method_check" CHECK ("floor_areas"."method" in ('laser', 'drawing', 'other'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"floor_id" uuid NOT NULL,
	"room_type" text NOT NULL,
	"name" text,
	"area_type" text NOT NULL,
	"below_ground" boolean NOT NULL,
	CONSTRAINT "rooms_room_type_check" CHECK ("rooms"."room_type" in ('bathroom', 'laundry', 'bathroom_laundry', 'room_with_drain', 'other_wet_room', 'kitchen', 'living_kitchen', 'toilet', 'sauna', 'boiler_room', 'technical_room', 'cold_room', 'swimming_pool', 'living_room', 'bedroom', 'office', 'family_room', 'dining_room', 'entrance', 'hallway', 'stairwell', 'wardrobe', 'storage', 'external_storage', 'basement_living_room', 'basement_room', 'crawl_space', 'attic_living_room', 'unfinished_attic', 'garage', 'glazed_balcony', 'workshop', 'other')),
	CONSTRAINT "rooms_area_type_check" CHECK ("rooms"."area_type" in ('bra_i', 'bra_e', 'bra_b'))
);
--> statement-breakpoint
ALTER TABLE "report_buildings" ADD CONSTRAINT "report_buildings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_buildings" ADD CONSTRAINT "report_buildings_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_report_building_fk" FOREIGN KEY ("organization_id","report_building_id") REFERENCES "public"."report_buildings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_areas" ADD CONSTRAINT "floor_areas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_areas" ADD CONSTRAINT "floor_areas_floor_fk" FOREIGN KEY ("organization_id","floor_id") REFERENCES "public"."floors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_areas" ADD CONSTRAINT "floor_areas_measured_by_fk" FOREIGN KEY ("organization_id","measured_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_fk" FOREIGN KEY ("organization_id","floor_id") REFERENCES "public"."floors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_buildings_organization_id_id_idx" ON "report_buildings" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "report_buildings_organization_id_assignment_id_idx" ON "report_buildings" USING btree ("organization_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floors_organization_id_id_idx" ON "floors" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "floors_organization_id_report_building_id_idx" ON "floors" USING btree ("organization_id","report_building_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floor_areas_organization_id_id_idx" ON "floor_areas" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "floor_areas_active_floor_idx" ON "floor_areas" USING btree ("organization_id","floor_id") WHERE "floor_areas"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_organization_id_id_idx" ON "rooms" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "rooms_organization_id_floor_id_idx" ON "rooms" USING btree ("organization_id","floor_id");