CREATE TABLE `attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('material_request','supply_flow','reverse_logistic') NOT NULL,
	`entityId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`fileUrl` varchar(1000) NOT NULL,
	`mimeType` varchar(100),
	`fileSize` int,
	`category` enum('factura','orden_compra','comprobante_entrega','foto_material','documento_proveedor','otro'),
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventoryItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sapItemCode` varchar(50) NOT NULL,
	`name` varchar(500) NOT NULL,
	`description` text,
	`unit` varchar(50),
	`category` varchar(100),
	`currentStock` decimal(12,2) NOT NULL DEFAULT '0',
	`minimumStock` decimal(12,2),
	`warehouseLocation` varchar(100),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventoryItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `materialRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestNumber` varchar(20) NOT NULL,
	`projectId` int NOT NULL,
	`requestedById` int NOT NULL,
	`recipient` enum('bodega_central','administrador_proyecto') NOT NULL,
	`status` enum('atendida','en_proceso','cerrada') NOT NULL DEFAULT 'en_proceso',
	`notes` text,
	`assignedFlow` enum('compra_directa','despacho_bodega','traslado_proyecto','solicitud_compra'),
	`processedById` int,
	`processedAt` timestamp,
	`closedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `materialRequests_id` PRIMARY KEY(`id`),
	CONSTRAINT `materialRequests_requestNumber_unique` UNIQUE(`requestNumber`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('nueva_solicitud','cambio_estatus','solicitud_compra','devolucion','sistema') NOT NULL,
	`relatedEntityType` varchar(50),
	`relatedEntityId` int,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`location` varchar(255),
	`status` enum('activo','inactivo','completado') NOT NULL DEFAULT 'activo',
	`sapProjectCode` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `requestItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`itemName` varchar(500) NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`unit` varchar(50),
	`sapItemCode` varchar(50),
	`sapItemDescription` varchar(500),
	`deliveredQuantity` decimal(12,2),
	`status` enum('pendiente','parcial','completo') NOT NULL DEFAULT 'pendiente',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `requestItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reverseLogistics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`returnNumber` varchar(20) NOT NULL,
	`returnType` enum('devolucion_bodega_central','devolucion_entre_proyectos','devolucion_proveedor') NOT NULL,
	`reasonCategory` enum('material_defectuoso','excedente','error_pedido','cambio_especificacion','otro') NOT NULL,
	`justification` text NOT NULL,
	`sourceProjectId` int NOT NULL,
	`destinationProjectId` int,
	`supplierName` varchar(255),
	`originalRequestId` int,
	`status` enum('pendiente','aprobada','en_transito','recibida','rechazada') NOT NULL DEFAULT 'pendiente',
	`sapDocumentType` varchar(50),
	`sapDocumentNumber` varchar(50),
	`sapSynced` boolean NOT NULL DEFAULT false,
	`createdById` int NOT NULL,
	`processedById` int,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reverseLogistics_id` PRIMARY KEY(`id`),
	CONSTRAINT `reverseLogistics_returnNumber_unique` UNIQUE(`returnNumber`)
);
--> statement-breakpoint
CREATE TABLE `reverseLogisticsItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reverseLogisticId` int NOT NULL,
	`itemName` varchar(500) NOT NULL,
	`sapItemCode` varchar(50),
	`quantity` decimal(12,2) NOT NULL,
	`unit` varchar(50),
	`condition` enum('nuevo','usado_buen_estado','defectuoso','danado') NOT NULL DEFAULT 'nuevo',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reverseLogisticsItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sapSyncLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('supply_flow','reverse_logistic','inventory') NOT NULL,
	`entityId` int NOT NULL,
	`sapDocumentType` varchar(50) NOT NULL,
	`sapDocumentNumber` varchar(50),
	`requestPayload` text,
	`responsePayload` text,
	`status` enum('success','error','pending') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sapSyncLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplyFlowRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`flowType` enum('compra_directa','despacho_bodega','traslado_proyecto','solicitud_compra') NOT NULL,
	`paymentMethod` enum('linea_credito','caja_chica'),
	`sourceWarehouse` varchar(100),
	`sourceProjectId` int,
	`destinationProjectId` int,
	`purchaseType` enum('local','extranjera'),
	`purchaseOrderNumber` varchar(50),
	`sapDocumentType` enum('entrada_mercancia','salida_inventario','transferencia_inventario','solicitud_compra','orden_compra'),
	`sapDocumentNumber` varchar(50),
	`sapSynced` boolean NOT NULL DEFAULT false,
	`sapSyncedAt` timestamp,
	`sapSyncError` text,
	`status` enum('pendiente','en_proceso','completado','cancelado') NOT NULL DEFAULT 'pendiente',
	`processedById` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplyFlowRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `buildreqRole` enum('ingeniero_residente','jefe_bodega_central','administracion_central');--> statement-breakpoint
ALTER TABLE `users` ADD `assignedProjectId` int;--> statement-breakpoint
CREATE INDEX `att_entity_idx` ON `attachments` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `inv_sap_code_idx` ON `inventoryItems` (`sapItemCode`);--> statement-breakpoint
CREATE INDEX `inv_category_idx` ON `inventoryItems` (`category`);--> statement-breakpoint
CREATE INDEX `mr_project_idx` ON `materialRequests` (`projectId`);--> statement-breakpoint
CREATE INDEX `mr_status_idx` ON `materialRequests` (`status`);--> statement-breakpoint
CREATE INDEX `mr_requested_by_idx` ON `materialRequests` (`requestedById`);--> statement-breakpoint
CREATE INDEX `notif_user_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `notif_read_idx` ON `notifications` (`userId`,`isRead`);--> statement-breakpoint
CREATE INDEX `ri_request_idx` ON `requestItems` (`requestId`);--> statement-breakpoint
CREATE INDEX `rl_source_project_idx` ON `reverseLogistics` (`sourceProjectId`);--> statement-breakpoint
CREATE INDEX `rl_return_type_idx` ON `reverseLogistics` (`returnType`);--> statement-breakpoint
CREATE INDEX `rl_status_idx` ON `reverseLogistics` (`status`);--> statement-breakpoint
CREATE INDEX `rli_reverse_logistic_idx` ON `reverseLogisticsItems` (`reverseLogisticId`);--> statement-breakpoint
CREATE INDEX `sap_entity_idx` ON `sapSyncLog` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `sfr_request_idx` ON `supplyFlowRecords` (`requestId`);--> statement-breakpoint
CREATE INDEX `sfr_flow_type_idx` ON `supplyFlowRecords` (`flowType`);