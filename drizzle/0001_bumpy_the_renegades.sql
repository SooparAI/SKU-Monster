CREATE TABLE `orderItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`sku` varchar(64) NOT NULL,
	`status` enum('pending','processing','completed','failed','skipped') NOT NULL DEFAULT 'pending',
	`imagesFound` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `orderItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','processing','completed','partial','failed') NOT NULL DEFAULT 'pending',
	`totalSkus` int NOT NULL DEFAULT 0,
	`processedSkus` int NOT NULL DEFAULT 0,
	`totalCost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`chargedAmount` decimal(10,2) NOT NULL DEFAULT '0.00',
	`zipFileUrl` text,
	`zipFileKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrapedImages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderItemId` int NOT NULL,
	`sku` varchar(64) NOT NULL,
	`sourceStore` varchar(64) NOT NULL,
	`sourceUrl` text NOT NULL,
	`imageUrl` text NOT NULL,
	`s3Key` varchar(512),
	`s3Url` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scrapedImages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`baseUrl` text NOT NULL,
	`searchUrlTemplate` text NOT NULL,
	`category` varchar(64) NOT NULL DEFAULT 'fragrance',
	`isActive` int NOT NULL DEFAULT 1,
	`selectors` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `stores_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('topup','charge','refund') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`paymentMethod` varchar(32),
	`paymentId` varchar(255),
	`status` enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `balance` decimal(10,2) DEFAULT '0.00' NOT NULL;