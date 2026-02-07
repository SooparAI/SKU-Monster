CREATE TABLE `scrapeLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`sku` varchar(64) NOT NULL,
	`step` varchar(64) NOT NULL,
	`status` enum('start','success','error') NOT NULL,
	`message` text,
	`details` json,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scrapeLogs_id` PRIMARY KEY(`id`)
);
