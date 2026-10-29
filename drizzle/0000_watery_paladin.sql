CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempts_email_time` ON `attempts` (`email`,`at`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`slot_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_id_unique` ON `bookings` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_confirmed_booking_per_slot` ON `bookings` (`slot_id`) WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX `bookings_email_sequence` ON `bookings` (`email`,`seq`);--> statement-breakpoint
CREATE TABLE `requests` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`fingerprint` text NOT NULL,
	`code` integer,
	`response` text,
	`retry_after` integer
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL
);
