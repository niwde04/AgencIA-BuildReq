CREATE TABLE `invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token` varchar(64) NOT NULL,
	`buildreqRole` enum('ingeniero_residente','jefe_bodega_central','administracion_central') NOT NULL,
	`assignedProjectId` int,
	`status` enum('pendiente','aceptada','expirada','cancelada') NOT NULL DEFAULT 'pendiente',
	`invitedById` int NOT NULL,
	`acceptedAt` timestamp,
	`acceptedUserId` int,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `inv_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE INDEX `inv_token_idx` ON `invitations` (`token`);--> statement-breakpoint
CREATE INDEX `inv_status_idx` ON `invitations` (`status`);