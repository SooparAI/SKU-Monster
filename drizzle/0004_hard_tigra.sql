ALTER TABLE `orders` ADD `sourceType` varchar(32) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `sourceFileName` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `excelFileUrl` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `excelFileKey` varchar(512);