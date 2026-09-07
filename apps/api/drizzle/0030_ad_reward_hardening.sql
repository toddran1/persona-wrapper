ALTER TABLE "ad_reward_events" ADD CONSTRAINT "ad_reward_events_status_check" CHECK ("ad_reward_events"."status" in ('verified_pending_grant', 'verified_processing', 'granted', 'rejected'));
--> statement-breakpoint
ALTER TABLE "ad_reward_sessions" ADD CONSTRAINT "ad_reward_sessions_status_check" CHECK ("ad_reward_sessions"."status" in ('pending', 'granted', 'rejected', 'expired'));
--> statement-breakpoint
CREATE INDEX "ad_reward_events_user_provider_status_granted_at_idx" ON "ad_reward_events" USING btree ("user_id","provider","status","granted_at");
--> statement-breakpoint
CREATE INDEX "ad_reward_sessions_user_status_expires_at_idx" ON "ad_reward_sessions" USING btree ("user_id","status","expires_at");
