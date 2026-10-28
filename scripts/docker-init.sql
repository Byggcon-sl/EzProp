-- Kjøres første gang databasen i Docker lages: egen database for de automatiske testene.
create database ezprop_test owner ezprop;
-- Lagring for synktjenesten (PowerSync, prøve fase 1). Ikke MongoDB. Finnes databasen fra før
-- uten denne, lager start.sh den.
create database powersync_storage owner ezprop;
