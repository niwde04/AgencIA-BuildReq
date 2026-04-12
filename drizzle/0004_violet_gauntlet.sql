CREATE TABLE `sapCatalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemCode` varchar(50) NOT NULL,
	`description` varchar(500) NOT NULL,
	`itemGroup` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sapCatalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `sapCatalog_itemCode_unique` UNIQUE(`itemCode`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplierCode` varchar(50) NOT NULL,
	`name` varchar(500) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_supplierCode_unique` UNIQUE(`supplierCode`)
);
--> statement-breakpoint
ALTER TABLE `materialRequests` MODIFY COLUMN `recipient` enum('bodega_central','administrador_proyecto','solicitud_compra') NOT NULL;--> statement-breakpoint
ALTER TABLE `materialRequests` MODIFY COLUMN `status` enum('en_espera','en_proceso','cerrada') NOT NULL DEFAULT 'en_espera';--> statement-breakpoint
CREATE INDEX `sap_cat_code_idx` ON `sapCatalog` (`itemCode`);--> statement-breakpoint
CREATE INDEX `sap_cat_desc_idx` ON `sapCatalog` (`description`);--> statement-breakpoint
CREATE INDEX `sup_code_idx` ON `suppliers` (`supplierCode`);